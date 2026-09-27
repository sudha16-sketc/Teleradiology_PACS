# syntax=docker/dockerfile:1
#
# OHIF is consumed same-origin from Axis at /ohif/ so that the viewer
# inherits the Axis session cookie. That is not optional: OHIF's DICOMweb
# client issues its QIDO-RS/WADO-RS requests with credentials: "same-origin",
# so if the viewer ran on its own origin (or on a different port) the browser
# would attach no cookie to /api/dicom-web and every study request would 401.
#
# The upstream ohif/app image, however, is published with its asset URLs baked
# in as root-relative. Because those names are content-hashed they change on
# every OHIF release, so proxying a hand-maintained list of asset paths is not a
# maintainable fix.
#
# So the public path is rebased once here, at build time, onto the directory the
# app is actually installed in. The single source of truth is the rspack public
# path (__webpack_require__.p), which is what builds the URL of every lazily
# loaded chunk and every WASM binary (~80 chunks in v3.13.0).
#
# Critically, that has to be done in EVERY bundle carrying a webpack runtime,
# not only the entry bundle. v3.13.0 ships nine independent webpack/rspack
# runtimes and eight of them still carry the upstream default "/". Because the
# runtime object is shared across chunks, evaluating any one of them resets the
# public path for the rest of the session, so patching the entry alone yields a
# viewer that first paints correctly and then starts requesting assets from the
# site root as soon as a lazy chunk lands. See the long comment at the patch
# loop below.
#
# The public path is NOT the only thing that has to be rebased, because it only
# governs URLs that the JS runtime builds. Four other sources bake in "/" and
# each one on its own reproduces a broken viewer:
#
#   1. index.html / manifest.json attribute values, resolved against the
#      document.
#   2. CSS url() references, which are literal strings inside the stylesheet
#      and are never passed through the runtime. In v3.13.0 this is the
#      @font-face woff2.
#   3. The browser/PWA manifests (browserconfig.xml, manifest.webapp,
#      yandex-browser-manifest.json), whose paths resolve against the document
#      ROOT, not against the document's own directory.
#   4. The one dynamic import() of the DICOM microscopy viewer, which
#      browserImportFunction() loads by absolute path.
#
# Left alone, these make the browser ask Axis for e.g.
# /a34f9d1faa5f3315.woff2 or /34b1e6b1deb5828e.wasm, receive the Axis 404 page --
# an HTML document starting with "<!DO" -- and then fail with
# "WebAssembly.instantiateStreaming(): expected magic word 00 61 73 6d,
# found 3c 21 44 4f". The service worker used to be the worst of these: it
# cached those HTML 404s and then served them in place of the binaries on later
# loads. It no longer runs at all -- see the note on the precache below.
#
# PUBLIC_URL below must stay in sync with the /ohif rewrite in
# apps/web/next.config.mjs. It is deliberately the only place the prefix is
# defined: the upstream entrypoint reads the same variable at startup for the
# SPA fallback and for locating app-config.js, so build and runtime cannot
# drift apart, and there is no way to override it at deploy time into a state
# where the bundle and the routes disagree.
#
# The assertions in this file fail the build if a future OHIF release changes
# the shape of what we patch, so a version bump can never silently ship a blank
# viewer again.
ARG OHIF_VERSION=v3.13.0
FROM ohif/app:${OHIF_VERSION}

# Upstream ships ENV PUBLIC_URL=/; rebase it onto the subdirectory below.
ENV PUBLIC_URL=/ohif/

# Install the app into the PUBLIC_URL subdirectory. OHIF's stock nginx config
# serves "location /" with "root /usr/share/nginx/html", so a subdirectory is
# reachable under a path prefix with no nginx changes at all, and the SPA
# fallback ${PUBLIC_URL}index.html resolves correctly. 50x.html is left at the
# document root because the error_page directive maps 5xx responses to it.
RUN set -eux; \
    html=/usr/share/nginx/html; \
    app="${html}${PUBLIC_URL%/}"; \
    prefix="${PUBLIC_URL%/}"; \
    mkdir -p "$app"; \
    for entry in "$html"/* "$html"/.[!.]*; do \
      [ -e "$entry" ] || continue; \
      if [ "$entry" != "$app" ] && [ "$entry" != "${app%/}" ] && [ "${entry##*/}" != "50x.html" ]; then \
        mv "$entry" "$app/"; \
      fi; \
    done; \
    test -f "$app/index.html"; \
    \
    # index.html carries the root-relative attribute values (entry bundle,
    # CSS, app-config.js, manifest, icons) and the runtime chunk loader;
    # manifest.json carries the PWA icons. Both ship as plain files.
    sed -i "s|=\"/|=\"$PUBLIC_URL|g" "$app/index.html"; \
    sed -i "s|\"/assets/|\"$prefix/assets/|g" "$app/manifest.json"; \
    \
    # The image ships every JS/CSS payload only as <file>.gz and leaves the
    # plain file as a 0-byte placeholder, because nginx runs
    # "gzip_static always" and therefore always serves the .gz. The bytes that
    # have to be patched consequently live inside the .gz, so decompress, patch
    # and recompress: patching the 0-byte placeholder would look successful
    # while nginx kept serving the stale, unpatched payload.
    #
    # The rspack public path is what builds the URL of every lazily loaded
    # chunk, WASM binary and assets/* file, so rebasing it is what actually
    # fixes runtime loading rather than just the first paint.
    #
    # It has to be rebased in EVERY bundle that embeds a webpack runtime, not
    # just the entry bundle. v3.13.0 ships nine independent webpack/rspack
    # runtimes, and eight of them still carry the upstream default:
    #
    #   8097.bundle.*.js, 8325.bundle.*.js, 8745.bundle.*.js,
    #   compute.bundle.*.js, histogram-worker.bundle.*.js,
    #   interpolation.bundle.*.js, polySeg.bundle.*.js
    #
    # Each embeds the "webpack/runtime/public_path" module, which assigns
    # __webpack_require__.p as a side effect of that chunk being evaluated. The
    # runtime object is shared across chunks, so evaluating any one of those
    # chunks overwrites the correct /ohif/ set in the entry bundle with "/" for
    # the remainder of the session. The breakage is therefore order-dependent
    # and invisible to a first paint: the viewer loads, then the lazy import of
    # 8097.bundle (the cornerstone/CODEC decoder bundle) lands and flips the
    # public path back to the site root. Every URL built after that point --
    # notably __webpack_require__.p + "34b1e6b1deb5828e.wasm" -- resolves as
    # /34b1e6b1deb5828e.wasm, gets the Axis HTML 404 page, and fails with
    # "WebAssembly.instantiateStreaming(): expected magic word 00 61 73 6d,
    # found 3c 21 44 4f".
    #
    # Patching only the entry bundle (the previous behaviour here) is what
    # produced exactly that error, so the loop below walks every .js payload in
    # the app tree and the assertion at the end re-scans all of them.
    #
    # The rewrite is applied to bare ".p = \"\"" as well as to the fully
    # qualified __webpack_require__ spelling, because the runtime is minified
    # and the receiver name is not stable across releases. An empty public path
    # (".p = ''" in oidc-client.min.js) is left alone: it resolves relative to
    # the document, which is already /ohif/.
    #
    # The DICOM microscopy viewer is the one exception the public path cannot
    # reach: browserImportFunction() loads it from an absolute literal instead.
    # It is rebased explicitly, anchored on a single-quoted absolute path,
    # because that bundle also contains browserify's "/node_modules/..."
    # argv/__filename stubs and a "/fake_*.js" fixture. Those are strings, not
    # asset URLs, and rewriting them would corrupt the bundle.
    #
    # Only payloads that actually changed are written back, so untouched vendor
    # bundles keep their upstream bytes. The plain file is truncated in every
    # case because nginx "gzip_static always" serves the .gz; patching the
    # 0-byte placeholder would look successful while the stale .gz kept being
    # served.
    pp_before=0; pp_files=0; pp_done=0; \
    find "$app" -name '*.js.gz' -print | sort > /tmp/js-gz.list; \
    while IFS= read -r jsgz; do \
      [ -n "$jsgz" ] || continue; \
      js="${jsgz%.gz}"; \
      # app-config.js is operator-supplied config bind-mounted over this path
      # at deploy time; it is not a webpack runtime and must stay untouched.
      case "${js##*/}" in app-config.js) continue ;; esac; \
      gunzip -c "$jsgz" > "$js.work"; \
      had=$(grep -o '\.p[[:space:]]*=[[:space:]]*"/"' "$js.work" | wc -l); \
      had_micro=$(grep -c "'/dicom-microscopy-viewer/" "$js.work" || true); \
      pp_before=$((pp_before + had)); \
      sed -i "s|\.p\([[:space:]]*=[[:space:]]*\)\"/\"|.p\1\"$PUBLIC_URL\"|g" "$js.work"; \
      sed -i "s|'\(/dicom-microscopy-viewer/\)|'$prefix\1|g" "$js.work"; \
      if grep -q '\.p[[:space:]]*=[[:space:]]*"/"' "$js.work"; then \
        echo "ERROR: an unpatched root public path remains in ${js##*/}" >&2; \
        exit 1; \
      fi; \
      if grep -qa "'/dicom-microscopy-viewer/" "$js.work"; then \
        echo "ERROR: an unpatched microscopy import remains in ${js##*/}" >&2; \
        exit 1; \
      fi; \
      if [ "$had" -gt 0 ] || [ "$had_micro" -gt 0 ]; then \
        pp_files=$((pp_files + 1)); \
        pp_done=$((pp_done + had)); \
        gzip -c "$js.work" > "$jsgz"; \
      fi; \
      rm -f "$js.work"; \
      : > "$js"; \
    done < /tmp/js-gz.list; \
    rm -f /tmp/js-gz.list; \
    if [ "$pp_before" -eq 0 ]; then \
      echo "ERROR: no root-valued webpack public path found; upstream layout changed" >&2; \
      exit 1; \
    fi; \
    if [ "$pp_done" -ne "$pp_before" ]; then \
      echo "ERROR: rebased $pp_done of $pp_before root public paths" >&2; \
      exit 1; \
    fi; \
    \
    # Re-scan every JS payload in the app tree, not just the ones the loop
    # rewrote, so a runtime added by a future OHIF release cannot reintroduce
    # the root public path unnoticed.
    strays=0; \
    for jsgz in $(find "$app" -name '*.js.gz' | sort); do \
      n=$(gunzip -c "$jsgz" | grep -o '\.p[[:space:]]*=[[:space:]]*"/"' | wc -l); \
      if [ "$n" -gt 0 ]; then \
        echo "ERROR: ${jsgz##*/} still defines a root public path ($n)" >&2; \
        strays=$((strays + n)); \
      fi; \
    done; \
    if [ "$strays" -ne 0 ]; then \
      exit 1; \
    fi; \
    entry_bundle=$(basename "$(find "$app" -maxdepth 1 -name 'app.bundle.*.js' | head -n1)"); \
    gunzip -c "$app/$entry_bundle.gz" | grep -q "__webpack_require__.p = \"$PUBLIC_URL\"" || \
      { echo "ERROR: $entry_bundle does not define the public path as $PUBLIC_URL" >&2; exit 1; }; \
    \

    # ---- Root-absolute references the public path cannot reach -------------- #
    # \
    # Everything above only covers URLs the JS runtime builds. These three
    # sources bake in "/" independently and each one alone reproduces a broken
    # viewer, so they are rebased here as well. patch_gz edits the .gz payload
    # for the same reason as the bundle above: nginx always serves the .gz.
    patch_gz() { \
        _f="$app/$1"; \
        if [ ! -f "$_f.gz" ]; then \
          echo "ERROR: $_f has no .gz payload; upstream layout changed" >&2; \
          exit 1; \
        fi; \
        gunzip -c "$_f.gz" > "$_f.work"; \
        sed -i "$2" "$_f.work"; \
        gzip -c "$_f.work" > "$_f.gz"; \
        rm -f "$_f.work"; \
        : > "$_f"; \
    }; \
    \
    # 1. CSS. A url() reference is a literal inside the stylesheet and never
    #    reaches the runtime, so __webpack_require__.p cannot fix it. In
    #    v3.13.0 the only one is the @font-face woff2 the viewer needs to
    #    render text. Relative url() values and data: URIs are untouched: only
    #    a leading "url(/" is a root-absolute reference.
    css_roots=$(gunzip -c "$app/app.bundle.css.gz" | grep -o 'url(/' | wc -l); \
    if [ "$css_roots" -eq 0 ]; then \
      echo "ERROR: no root-absolute url() in app.bundle.css; upstream layout changed" >&2; \
      exit 1; \
    fi; \
    patch_gz "app.bundle.css" "s|url(/\([A-Za-z0-9._/-]\)|url($PUBLIC_URL\1|g"; \
    css_done=$(gunzip -c "$app/app.bundle.css.gz" | grep -o "url($PUBLIC_URL" | wc -l); \
    if [ "$css_done" -ne "$css_roots" ]; then \
      echo "ERROR: rebased $css_done of $css_roots root-absolute url() in app.bundle.css" >&2; \
      exit 1; \
    fi; \
    \
    # 3. The browser/PWA manifests, which resolve their icon paths against the
    #    document root too. These ship as plain files, so they are patched in
    #    place. Only /assets/... is rewritten: these files contain no other
    #    absolute paths.
    for m in assets/browserconfig.xml assets/manifest.webapp assets/yandex-browser-manifest.json; do \
      if [ ! -f "$app/$m" ]; then \
        echo "ERROR: $m is missing; upstream layout changed" >&2; \
        exit 1; \
      fi; \
      sed -i "s|\"/assets/|\"$prefix/assets/|g" "$app/$m"; \
    done; \
    grep -q "$prefix/assets/mstile-70x70.png" "$app/assets/browserconfig.xml"; \
    grep -q "$prefix/assets/firefox_app_512x512.png" "$app/assets/manifest.webapp"; \
    if grep -qa '"/assets/' "$app/assets/browserconfig.xml" "$app/assets/manifest.webapp" "$app/assets/yandex-browser-manifest.json"; then \
      echo "ERROR: an unpatched /assets/ reference remains in a browser manifest" >&2; \
      exit 1; \
    fi; \
    \
    # ---- Layer 1: make the content hash in the filename actually be one ----- #
    # \
    # Everything above rewrites the BYTES of content-hashed assets but leaves
    # their NAMES alone, and the names are not content hashes to begin with:
    # they are upstream rspack build IDs that match neither the upstream nor
    # the patched bytes. The result is a URL that serves two different payloads
    # across deploys, e.g. 8097.bundle.8ae6404ba94890a0.js held publicPath "/"
    # before the patch and "/ohif/" after it, at the same address. Browsers are
    # then free to keep executing the old bytes indefinitely, which is what
    # produced "expected magic word 00 61 73 6d, found 3c 21 44 4f" long after
    # the image was corrected.
    # \
    # So the names are recomputed here, from the patched payloads, and every
    # reference to them is rewritten. The one thing this must get right is
    # completeness: rspack does not look chunk names up in a manifest, it builds
    # them at runtime from an inline chunk->hash map embedded in each bundle
    # (__webpack_require__.u = id => id + ".bundle." + {1229:"f721ec...",...}[id]
    # + ".js"), and references WASM the same flat way (__webpack_require__.p +
    # "34b1e6b1deb5828e.wasm"). Renaming a file without rewriting those maps
    # would 404 the viewer rather than merely serve stale code, so every hash
    # literal is substituted across every JS/CSS payload, index.html and sw.js
    # below, and the result is checked for dangling references afterwards.
    # \
    # Each name must be the digest of the bytes nginx will actually SERVE, not
    # of some intermediate state. That is stricter than it sounds, because the
    # bytes of a bundle change once its references are rewritten: rename 8097 and
    # the entry bundle's inline chunk map changes too, so the entry needs a new
    # name as well. Fingerprinting each file in isolation would leave the entry
    # pointing at a URL that is served with immutable caching under a name that
    # no longer describes its contents.
    # \
    # So the name assignment is solved as a fixed point instead. Start from the
    # identity map and repeatedly re-derive every name from the served bytes
    # until nothing moves. The graph is two deep (entry -> chunks -> WASM/font
    # leaves) and the leaves never move, so it settles in a few rounds; the loop
    # is bounded and fails loudly rather than shipping an unconverged tree.
    # \
    # One file cannot participate: compute.bundle embeds its own hash in its
    # chunk map (8547:"..."), so "name == digest(served bytes)" has no solution
    # and iterating it simply oscillates. Its own name is therefore computed
    # with its self-reference blanked to a constant -- the same self-hash
    # exclusion Git and Nix use -- so the name still changes whenever any byte of
    # the file changes, it is still deterministic, and it is still a unique
    # stable token. Only that one file's URL is not literally its own digest
    # prefix, and nothing depends on it being one.
    # \
    # fp_hash prints the fingerprint of the bytes nginx will actually serve.
    # Upstream ships JS and CSS only as <file>.gz and leaves a 0-byte plain
    # file (gzip_static always), while WASM and fonts are plain files.
    fp_hash() { \
        if [ -f "$1.gz" ] && [ -s "$1.gz" ]; then gzip -dc < "$1.gz" | sha256sum | cut -c1-16; \
        else sha256sum < "$1" | cut -c1-16; fi; \
    }; \
    fp_dump() { if [ -f "$1.gz" ] && [ -s "$1.gz" ]; then gzip -dc < "$1.gz"; else cat "$1" 2>/dev/null; fi; }; \
    fp_list=/tmp/fp.list; fp_map=/tmp/fp.map; fp_cand=/tmp/fp.cand; \
    fp_mv=/tmp/fp.mv; fp_sed=/tmp/fp.sed; \
    fp_blank=0000000000000000; \
    find "$app" -type f ! -name '*.gz' \
        | sed "s|^$app/||" \
        | grep -E '[0-9a-f]{16}\.(js|css|wasm|woff2)$' | sort > "$fp_list"; \
    fp_n=$(wc -l < "$fp_list"); \
    if [ "$fp_n" -eq 0 ]; then \
      echo "ERROR: no content-hashed assets found; upstream layout changed" >&2; \
      exit 1; \
    fi; \
    : > "$fp_map"; \
    while IFS= read -r rel; do \
      old=$(printf '%s' "$rel" | grep -oE '[0-9a-f]{16}' | head -n1); \
      case "$rel" in *"$old"*) ;; *) echo "ERROR: no hash in $rel" >&2; exit 1 ;; esac; \
      printf '%s %s\n' "$old" "$old" >> "$fp_map"; \
    done < "$fp_list"; \
    fp_iter=0; fp_converged=0; \
    while [ "$fp_iter" -lt 12 ]; do \
      fp_iter=$((fp_iter + 1)); \
      : > "$fp_sed"; \
      while read -r old new; do \
        if [ "$old" != "$new" ]; then printf 's/%s/%s/g\n' "$old" "$new" >> "$fp_sed"; fi; \
      done < "$fp_map"; \
      : > "$fp_cand"; \
      while IFS= read -r rel; do \
        old=$(printf '%s' "$rel" | grep -oE '[0-9a-f]{16}' | head -n1); \
        cur=$(awk -v o="$old" '$1==o{print $2}' "$fp_map"); \
        if fp_dump "$app/$rel" | grep -qE "[0-9]+: \"$old\""; then \
          cand=$(fp_dump "$app/$rel" | sed -f "$fp_sed" | sed "s/$cur/$fp_blank/g" | sha256sum | cut -c1-16); \
        else \
          cand=$(fp_dump "$app/$rel" | sed -f "$fp_sed" | sha256sum | cut -c1-16); \
        fi; \
        if [ -z "$cand" ]; then echo "ERROR: could not fingerprint $rel" >&2; exit 1; fi; \
        printf '%s %s\n' "$old" "$cand" >> "$fp_cand"; \
      done < "$fp_list"; \
      if cmp -s "$fp_cand" "$fp_map"; then fp_converged=1; break; fi; \
      cp "$fp_cand" "$fp_map"; \
    done; \
    if [ "$fp_converged" -ne 1 ]; then \
      echo "ERROR: asset names did not converge in $fp_iter rounds" >&2; \
      exit 1; \
    fi; \
    if [ "$(cut -d' ' -f2 "$fp_map" | sort -u | wc -l)" -ne "$fp_n" ]; then \
      echo "ERROR: two assets would collapse onto the same name" >&2; \
      exit 1; \
    fi; \
    : > "$fp_mv"; \
    while IFS= read -r rel; do \
      old=$(printf '%s' "$rel" | grep -oE '[0-9a-f]{16}' | head -n1); \
      new=$(awk -v o="$old" '$1==o{print $2}' "$fp_map"); \
      echo "$rel $(printf '%s' "$rel" | sed "s/$old/$new/")" >> "$fp_mv"; \
    done < "$fp_list"; \
    # Two-phase rename, so a digest that happens to equal another asset's
    # current name cannot make one mv overwrite a file that has not moved yet.
    # The .gz payload has to travel with the file: nginx resolves the payload by
    # appending .gz to the name that was requested, so a renamed .js still
    # carrying its old .gz would keep serving the superseded bytes.
    while read -r from to; do \
      mv "$app/$from" "$app/$to.fpstage"; \
      if [ -f "$app/$from.gz" ]; then mv "$app/$from.gz" "$app/$to.gz.fpstage"; fi; \
    done < "$fp_mv"; \
    while read -r from to; do \
      mv "$app/$to.fpstage" "$app/$to"; \
      if [ -f "$app/$to.gz.fpstage" ]; then mv "$app/$to.gz.fpstage" "$app/$to.gz"; fi; \
    done < "$fp_mv"; \
    : > "$fp_sed"; \
    while read -r old new; do printf 's/%s/%s/g\n' "$old" "$new" >> "$fp_sed"; done < "$fp_map"; \
    fp_rewrite() { \
        _f="$1"; \
        if [ -f "$_f.gz" ] && [ -s "$_f.gz" ]; then \
          gzip -dc < "$_f.gz" | sed -f "$fp_sed" | gzip -c > "$_f.gz.fpstage"; \
          mv "$_f.gz.fpstage" "$_f.gz"; \
        elif [ -s "$_f" ]; then \
          sed -f "$fp_sed" "$_f" > "$_f.fpstage"; \
          mv "$_f.fpstage" "$_f"; \
        fi; \
    }; \
    for f in $(find "$app" -type f \( -name '*.js' -o -name '*.css' \)); do fp_rewrite "$f"; done; \
    # sw.js is retired in Layer 2, but it is still rewritten here: the
    # superseded-hash sweep below concatenates every .js in the tree, so leaving
    # the old asset names inside sw.js would fail the build.
    for f in "$app/index.html" "$app/sw.js" "$app/manifest.json" "$app/assets/browserconfig.xml" \
             "$app/assets/manifest.webapp" "$app/assets/yandex-browser-manifest.json"; do \
      if [ -f "$f" ]; then fp_rewrite "$f"; fi; \
    done; \
    # Nothing that was superseded may survive, or a browser could still reach
    # the old payload under a name the app no longer uses. All payloads are
    # concatenated once, because re-reading them per old hash is quadratic.
    find "$app" -type f \
        \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' \
           -o -name '*.xml' -o -name '*.webapp' \) | sort > /tmp/fp.payloads; \
    : > /tmp/fp.all; \
    while IFS= read -r f; do fp_dump "$f" >> /tmp/fp.all; done < /tmp/fp.payloads; \
    fp_stale=0; \
    while read -r old new; do \
      hits=$(grep -o "$old" /tmp/fp.all | wc -l); \
      if [ "$hits" -gt 0 ]; then \
        echo "ERROR: superseded hash $old still appears $hits time(s)" >&2; \
        fp_stale=$((fp_stale + hits)); \
      fi; \
    done < "$fp_map"; \
    if [ "$fp_stale" -ne 0 ]; then exit 1; fi; \
    rm -f /tmp/fp.all; \
    # The name must be the digest of the payload, except for the assets whose
    # bytes the substitution itself rewrote: those embed references to other
    # assets and are named after the pre-substitution payload by design (see
    # above). For them the digest legitimately moves, so require the move to be
    # explained by a cross-asset reference rather than accepted blindly.
    # Name equals digest of served bytes, except the known self-embedding case.
    fp_moved=0; \
    while read -r from to; do \
      want=$(printf '%s' "$to" | grep -oE '[0-9a-f]{16}' | head -n1); \
      got=$(fp_hash "$app/$to"); \
      if [ "$got" != "$want" ]; then \
        # If it's the compute bundle, the self-hash is deliberately masked. The
        # want we get here is the name from the final map: check that the served
        # bytes with self-hash masked give the same name.
        own=$want; \
        if fp_dump "$app/$to" | grep -qE "[0-9]+: \"$own\""; then \
          exp=$(fp_dump "$app/$to" | sed "s/$own/$fp_blank/g" | sha256sum | cut -c1-16); \
          if [ "$exp" = "$own" ]; then fp_moved=1; else exit 1; fi; \
        else \
          echo "ERROR: $to is named $want but digests to $got" >&2; \
          exit 1; \
        fi; \
      fi; \
    done < "$fp_mv"; \
    # Every runtime reference must resolve to a file that exists, or the viewer
    # 404s a chunk or a WASM binary at load time. rspack builds chunk names from
    # an inline "<id>": "<hash>" map and references binaries as a flat
    # .p + "<hash>.wasm", so both shapes are resolved here against the real tree.
    # Every runtime reference must resolve to a file that exists, or the viewer
    # 404s a chunk or a WASM binary at load time. rspack builds chunk names from
    # an inline "<id>": "<hash>" map and references binaries as a flat
    # .p + "<hash>.wasm", so both shapes are resolved here against the real tree.
    find "$app" -type f | sed "s|^$app/||" | sort > /tmp/fp.names; \
    fp_dangling=0; \
    while IFS= read -r f; do \
      payload=$(fp_dump "$f"); \
      for r in $(printf '%s' "$payload" | grep -oE '[0-9a-f]{16}\.(js|css|wasm|woff2)"' | grep -oE '[0-9a-f]{16}\.(js|css|wasm|woff2)' | sort -u); do \
        if ! grep -qE "(^|[./])$r\$" /tmp/fp.names; then \
          echo "ERROR: ${f##*/} references missing asset $r" >&2; \
          fp_dangling=$((fp_dangling + 1)); \
        fi; \
      done; \
      for c in $(printf '%s' "$payload" | grep -oE '[0-9]+: "[0-9a-f]{16}"' | grep -oE '[0-9a-f]{16}' | sort -u); do \
        if ! grep -q "\.$c\.js\$" /tmp/fp.names; then \
          echo "ERROR: ${f##*/} maps a chunk to missing hash $c" >&2; \
          fp_dangling=$((fp_dangling + 1)); \
        fi; \
      done; \
    done < /tmp/fp.payloads; \
    if [ "$fp_dangling" -ne 0 ]; then exit 1; fi; \
    echo "refingerprinted $fp_n assets ($fp_moved embed cross-asset references); references consistent"; \
    \
    # ---- Layer 2: retire the service worker, then fix nginx caching ------- #
    # \
    # upstream's sw.js cannot run, and cannot be made to run by anything this
    # image controls. It is a Create React App dev-build artifact that does
    #   importScripts('https://storage.googleapis.com/workbox-cdn/...')
    # at top level, and a cross-origin importScripts throws inside the service
    # worker global scope. Registering it fails outright with "ServiceWorker
    # script evaluation failed"; nothing that runs during our build can change
    # that without vendoring workbox, which would add a build-time network
    # dependency for a precache we do not need. On top of that
    # init-service-worker.js refuses to register anything unless the hostname
    # is not localhost/127.*, so on a local deployment it is dead code anyway.
    # \
    # The precache is also redundant here. Every asset is content-addressed by
    # Layer 1 and served immutable for a year, so a byte change produces a new
    # URL rather than a stale cache entry, and the one file whose name cannot
    # change (app.bundle.css) is served no-cache and revalidated on every load.
    # A precache would add a second copy of the whole app and a new way for a
    # stale entry to survive a redeploy.
    # \
    # So the worker is removed from the critical path rather than repaired:
    # init-service-worker.js is reduced to an unregister-only stub, which both
    # stops any new registration and tears down a worker left behind by an
    # earlier deployment. sw.js itself is left on disk, served no-cache below,
    # so an existing registration's update check revalidates instead of being
    # answered from cache.
    isw="$app/init-service-worker.js"; \
    if [ ! -f "$isw" ] && [ ! -f "$isw.gz" ]; then \
      echo "ERROR: init-service-worker.js is missing; upstream layout changed" >&2; \
      exit 1; \
    fi; \
    printf '%s\n' \
      '// The upstream precache worker is deliberately not registered.' \
      '//' \
      '// This stub exists only to tear down a service worker that an earlier' \
      '// deployment of this app may have installed, so that no stale worker can' \
      '// keep serving superseded bundles out of the Cache API.' \
      '(function () {' \
      "  if (!('serviceWorker' in navigator)) return;" \
      '  navigator.serviceWorker' \
      '    .getRegistrations()' \
      '    .then(function (registrations) {' \
      '      registrations.forEach(function (registration) {' \
      '        registration.unregister();' \
      '      });' \
      '    })' \
      '    .catch(function () {});' \
      '})();' > /tmp/isw.stub; \
    gzip -c /tmp/isw.stub > "$isw.gz"; \
    # every .js in this image is a zero-byte placeholder served through its
    # .gz companion, so keep that pairing intact
    [ -f "$isw" ] || : > "$isw"; \
    if ! fp_dump "$isw" | grep -q 'unregister'; then \
      echo "ERROR: init-service-worker.js stub was not written" >&2; \
      exit 1; \
    fi; \
    if fp_dump "$isw" | grep -qaE 'workbox|importScripts|serviceWorker\.register'; then \
      echo "ERROR: init-service-worker.js stub still references workbox" >&2; \
      exit 1; \
    fi; \
    echo "retired the precache service worker (init-service-worker.js is now an unregister-only stub)"; \
    \
    # \
    # Neither upstream nginx nor the Next.js rewrite sets Cache-Control, so a
    # browser falls back to heuristic freshness and may reuse a response whose
    # URL it believes is immutable. The document and the worker must always
    # revalidate (they are what points at the current hashed names); the hashed
    # assets may be cached forever, because Layer 1 guarantees a changed byte
    # always implies a changed URL.
    # The image ships NO baked-in server block: /usr/src/entrypoint.sh renders
    # /usr/src/default.conf.template through envsubst into
    # /etc/nginx/conf.d/default.conf on every container start, overwriting
    # whatever is there. So the header has to be added to the template, or it is
    # silently thrown away at runtime. The entrypoint calls
    # `envsubst '${PORT}:${PUBLIC_URL}'`, i.e. with an explicit variable list, so
    # $axis_ohif_cache passes through untouched just like $uri and $host do.
    #
    # The optional `(/.*[./])?` prefix is what lets the bare-hash names this app
    # also ships (<hash>.wasm, <hash>.woff2) match as well as the
    # <id>.bundle.<hash>.js / <name>.<hash>.css shapes. Requiring a [./] before
    # the hash leaves the bare names on the default no-cache policy.
    # The regex is quoted because nginx tokenises `{` as a block delimiter: an
    # unquoted {16} makes the parser report "unexpected {" on the next line.
    printf '%s\n' \
      'map $uri $axis_ohif_cache {' \
      '    default                    "no-cache";' \
      '    "~^/ohif/sw\.js$"            "no-cache, no-store, must-revalidate";' \
      '    "~^/ohif/init-service-worker\.js$" "no-cache, no-store, must-revalidate";' \
      '    "~^/ohif/(.*[./])?[0-9a-f]{16}\.(js|css|wasm|woff2)$" "public, max-age=31536000, immutable";' \
      '}' \
      > /etc/nginx/conf.d/00-ohif-cache.conf; \
    # 00- sorts ahead of default.conf, and nginx resolves a map variable while it
    # parses the config, so the map has to be read before the server block that
    # uses it. Writing this after default.conf fails with "unknown variable".
    for tpl in /usr/src/default.conf.template /usr/src/default.ssl.conf.template; do \
      if [ ! -f "$tpl" ]; then continue; fi; \
      if grep -q 'add_header Cache-Control $axis_ohif_cache always;' "$tpl"; then continue; fi; \
      if ! grep -q 'add_header Cross-Origin-Resource-Policy same-origin;' "$tpl"; then \
        echo "ERROR: $tpl no longer carries the CORP anchor line" >&2; \
        exit 1; \
      fi; \
      sed -i \
        's|\( *\)add_header Cross-Origin-Resource-Policy same-origin;|\1add_header Cross-Origin-Resource-Policy same-origin;\n\1add_header Cache-Control $axis_ohif_cache always;|' \
        "$tpl"; \
      grep -q 'add_header Cache-Control $axis_ohif_cache always;' "$tpl"; \
    done; \
    # Render the config exactly the way the entrypoint will and prove it parses,
    # so a broken map or header cannot reach a running container. Port 8080
    # rather than 80: since 1.25 `nginx -t` also binds the listen socket, and
    # the build container has no CAP_NET_BIND_SERVICE. Only the parsed result
    # matters here; the entrypoint re-renders with the real PORT at start.
    PORT=8080 PUBLIC_URL="$PUBLIC_URL" envsubst '${PORT}:${PUBLIC_URL}' < /usr/src/default.conf.template > /etc/nginx/conf.d/default.conf; \
    grep -q 'add_header Cache-Control \$axis_ohif_cache always;' /etc/nginx/conf.d/default.conf; \
    nginx -t; \
    \
    # Operators poking the container port directly (host :3001) are pointed at
    # the proxied path instead of a 404 from the now-empty document root.
    printf '%s\n' \
      '<!doctype html><title>OHIF</title>' \
      "<meta http-equiv=\"refresh\" content=\"0; url=$PUBLIC_URL\">" \
      "<a href=\"$PUBLIC_URL\">Open the OHIF viewer</a>" \
      > "$html/index.html"; \
    \
    # Fail the build rather than ship a viewer that cannot load its own code.
    needle_bundle="src=\"$PUBLIC_URL"'app.bundle'; \
    needle_public="window.PUBLIC_URL=\"$PUBLIC_URL\""; \
    needle_icon="\"$prefix"'/assets/'; \
    grep -q "$needle_bundle" "$app/index.html"; \
    grep -q "$needle_public" "$app/index.html"; \
    grep -q "$needle_icon" "$app/manifest.json"; \
    chown -R nginx:nginx "$html"
