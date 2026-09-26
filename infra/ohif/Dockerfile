# syntax=docker/dockerfile:1
#
# OHIF is consumed same-origin from Axis at /ohif/ so that the viewer
# inherits the Axis session cookie. That is not optional: OHIF's DICOMweb
# client issues its QIDO-RS/WADO-RS requests with credentials: "same-origin",
# so if the viewer ran on its own origin (or on a different port) the browser
# would attach no cookie to /api/dicom-web and every study request would 401.
#
# The upstream ohif/app image, however, is published with its asset URLs baked
# in as root-relative. index.html loads "/app.bundle.<hash>.js" and the rspack
# runtime hardcodes __webpack_require__.p = "/", which is also what builds the
# URL of every lazily loaded chunk, WASM binary and assets/* file (~80 chunks
# in v3.13.0). Because those names are content-hashed they change on every OHIF
# release, so proxying a hand-maintained list of asset paths is not a
# maintainable fix.
#
# So the public path is rebased once here, at build time, onto the directory the
# app is actually installed in. The rspack public path is the single source of
# truth for all chunk/asset URLs, so one rewrite covers both the initial load
# and everything loaded lazily afterwards.
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
    for js in "$app"/app.bundle.*.js; do \
      if [ ! -f "$js.gz" ]; then \
        echo "ERROR: $js has no .gz payload; upstream layout changed" >&2; \
        exit 1; \
      fi; \
      gunzip -c "$js.gz" > "$js.work"; \
      sed -i "s|__webpack_require__\.p[[:space:]]*=[[:space:]]*\"/\"|__webpack_require__.p = \"$PUBLIC_URL\"|g" "$js.work"; \
      if grep -q '__webpack_require__\.p[[:space:]]*=[[:space:]]*"/"' "$js.work"; then \
        echo "ERROR: an unpatched public path definition remains in $js" >&2; \
        exit 1; \
      fi; \
      grep -q "__webpack_require__\.p = \"$PUBLIC_URL\"" "$js.work"; \
      gzip -c "$js.work" > "$js.gz"; \
      rm -f "$js.work"; \
      : > "$js"; \
      gunzip -c "$js.gz" | grep -q "__webpack_require__\.p = \"$PUBLIC_URL\""; \
    done; \
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
