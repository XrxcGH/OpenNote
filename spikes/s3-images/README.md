# Spike S3: image memory

Measures what 12-megapixel photos cost on a page in Microsoft Edge (WebView2's engine), as the original and as a display-size rendition. The result and the decision are in [docs/perf/images.md](../../docs/perf/images.md).

```sh
node spikes/s3-images/run.ts --images 24
```

It needs Microsoft Edge and Windows PowerShell, because it reads each browser process's working set through WMI. It writes `spikes/results/s3-images.json`.
