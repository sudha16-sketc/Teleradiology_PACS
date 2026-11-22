import os, sys, pydicom
for r, _, fs in os.walk(sys.argv[1]):
    for f in fs:
        p = os.path.join(r, f)
        try:
            ds = pydicom.dcmread(p, stop_before_pixels=True, force=True)
            ts = ds.file_meta.get("TransferSyntaxUID")
            print(os.path.getsize(p), ts, getattr(ts, "name", ""), p)
        except Exception:
            print(os.path.getsize(p), "ERR", p)