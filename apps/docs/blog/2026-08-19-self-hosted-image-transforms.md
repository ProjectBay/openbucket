---
slug: self-hosted-image-transforms
title: 'Build your own Cloudinary-lite: on-the-fly image transforms on GET'
description: Store one original, request any variant with query params. Self-hosted image resizing with WebP/AVIF, srcset, caching, and DoS bounds — no per-image fees.
authors: [openbucket]
tags: [images, tutorial, performance, self-hosted, nestjs]
date: 2026-08-19
draft: true
keywords:
  [
    self-hosted image resizing,
    cloudinary alternative self-hosted,
    on the fly image resize nodejs,
    nestjs image optimization,
    self-hosted image cdn,
    webp avif conversion server,
  ]
---

Image pipelines have a way of growing sideways. You start with one upload, then
the design needs a 200px thumbnail, then the landing page wants a 1600px hero,
then someone asks why you're shipping 2 MB JPEGs to phones that speak AVIF. The
usual fixes are a paid transform service (Cloudinary, imgix) or yet another
container to babysit (Thumbor, imgproxy).

OpenBucket bakes this into the object store you already have: **store one
original, and every variant is just query params on the GET URL**. `?w=400&format=webp`
resizes and re-encodes on the fly, caches the result forever, and serves the next
request from disk. In this post we'll upload one image and get responsive
`srcset` variants, modern formats, and crop modes out of it — then look honestly
at what this is *not*.

<!-- truncate -->

## One original, many URLs

Transforms run on the normal S3 GET route. Any authorized object GET becomes a
transform request when at least one of `w`, `h`, or `format` is present:

```
GET /assets/hero.jpg?w=400&format=webp
```

The full grammar is five params:

| Param    | Meaning                    | Values                                          | Default         |
| -------- | -------------------------- | ----------------------------------------------- | --------------- |
| `w`      | Target width in pixels     | `1 … 4096`                                      | —               |
| `h`      | Target height in pixels    | `1 … 4096`                                      | —               |
| `fit`    | How to fit within `w`/`h`  | `cover`, `contain`, `fill`, `inside`, `outside` | `cover`         |
| `format` | Re-encode to this format   | `webp`, `jpeg`, `png`, `avif`                   | native format   |
| `q`      | Encode quality             | `1 … 100`                                       | `80`            |

Two useful edge behaviors: omit `w` and `h` and the image keeps its dimensions
but re-encodes (a plain `?format=webp` is a format conversion), and **upscaling
is disabled** — a source smaller than the requested size comes back at its own
size, never enlarged. EXIF orientation is honored, so portrait phone photos
arrive the right way up.

## Step 1 — Upload the original

OpenBucket speaks S3, so any client works. With the AWS CLI pointed at your
instance:

```bash
aws s3 cp ./hero.jpg s3://assets/hero.jpg \
  --endpoint-url http://localhost:3000/storage
```

Or, if you followed the [NestJS uploads tutorial](/docs/guides/file-uploads),
the multer interceptor already put it there. Either way: that's the last resize
decision you make at upload time. Store the biggest original you have.

## Step 2 — Responsive images with `srcset`

Because every variant is just a URL, `srcset` needs no build step and no
pre-generated renditions:

```html
<img
  src="/storage/assets/hero.jpg?w=800&format=webp"
  srcset="
    /storage/assets/hero.jpg?w=400&format=webp   400w,
    /storage/assets/hero.jpg?w=800&format=webp   800w,
    /storage/assets/hero.jpg?w=1600&format=webp 1600w
  "
  sizes="(max-width: 600px) 100vw, 800px"
  alt="Hero"
/>
```

The browser picks a width; OpenBucket renders that width once and caches it.
Add a retina thumbnail (`?w=200&h=200&fit=cover` — a centered square crop) or a
letterboxed preview (`fit=contain`) the same way. `fit=inside` is the "shrink to
fit, never crop" mode you want for user-supplied content of unknown aspect
ratio.

## Step 3 — Modern formats

Output formats are `webp`, `jpeg`, `png`, and `avif`. Decodable **source**
formats are JPEG, PNG, WebP, AVIF, GIF, and TIFF — anything else, including SVG,
passes straight through to the normal GET untouched (SVG is deliberately
excluded as an active-content surface). So:

```
?format=avif&q=60      # same dimensions, AVIF at quality 60
?w=1200&format=webp    # 1200px-wide WebP
```

One honest caveat: there's no `Accept`-header content negotiation — you pick
the format in the URL. For most apps that's fine (ship AVIF or WebP with a
`<picture>` fallback); it's one of the places a dedicated image CDN does more.

## What happens on the second request

The first request decodes, resizes, and re-encodes with sharp. Everything after
that is a disk read, because each derivative is **content-addressed**: the cache
key is a hash of the source object's ETag plus the exact transform params, and
the files live under `DATA_DIR/derivatives/`.

That one design choice buys three things:

- **Immutable caching.** The response carries the derivative's content hash as
  its `ETag` and `Cache-Control: public, max-age=31536000, immutable`. A browser
  revalidating with `If-None-Match` gets a `304` with zero decode work — and any
  CDN or reverse-proxy cache in front can hold the response indefinitely.
- **Invalidation for free.** Overwrite the source object and its ETag changes,
  so every derivative URL naturally resolves to a fresh render. Orphaned old
  derivatives are reclaimed by a background GC tick against a size cap
  (`DERIVATIVE_CACHE_MAX_BYTES`, default 5 GiB). No purge API to call, no
  cache-busting query hacks.
- **No stampedes.** A cold-cache burst is collapsed by single-flight: one
  decode, one write, every concurrent requester gets the shared result.

## The presigned-URL gotcha

A presigned URL signs its **entire query string**. Tack `?w=400` onto a minted
presigned GET and you've broken the signature — the request is rejected. To use
transforms you either serve from a **public-read bucket** (attach an anonymous
`s3:GetObject` bucket policy, then plain `<img src>` URLs work — see
[Sharing files](/docs/guides/sharing-files)) or issue a fully SigV4-signed
request with the transform params baked into what's signed. For `<img>` tags on
a public site, the public bucket is the usual answer.

Authorization itself is unchanged: a transform GET runs through exactly the same
`s3:GetObject` checks as a plain GET. No new access path.

## The part that keeps you off the front page of HN

An open resize endpoint is a classic DoS target — "please decode this
30,000×30,000 PNG at quality 100, a thousand times". OpenBucket's defense is
layered, and every knob is a bound:

| Env var                              | Default             | What it bounds                          |
| ------------------------------------ | ------------------- | --------------------------------------- |
| `IMAGE_TRANSFORM_ENABLED`            | `true`              | Master switch                            |
| `MAX_TRANSFORM_DIMENSION`            | `4096`              | Max `w`/`h`, enforced before any decode  |
| `MAX_TRANSFORM_INPUT_BYTES`          | 50 MiB              | Refuses oversized sources pre-buffer     |
| `IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS` | 576,000,000         | Decompression bomb → `400`               |
| `IMAGE_TRANSFORM_CONCURRENCY`        | `4`                 | Concurrent decodes; the rest queue       |
| `DERIVATIVE_CACHE_MAX_BYTES`         | 5 GiB               | On-disk derivative cache cap             |

Bad input — an out-of-range dimension, an unknown format, an undecodable file —
is always an S3-style `400`, never a `500` or an OOM. The per-IP request
throttle sits in front of all of it.

## Where this sits next to Cloudinary, imgix, and Thumbor

Being upfront: **OpenBucket is not a CDN.** Cloudinary and imgix run global edge
networks, do `Accept`-based format negotiation, and offer far deeper transform
DSLs (face detection, watermarks, smart crop). OpenBucket is a single-node,
pre-1.0 store — your images render on your box, at your box's latency.

What you get in exchange:

- **Zero per-image, per-transform, per-bandwidth fees.** The pricing model is
  "your disk".
- **Data stays on your infrastructure** — no third party ever holds your
  originals.
- **No extra moving part.** Thumbor and imgproxy are good software, but they're
  another service with its own config, auth story, and deploys. Here the
  transform pipeline lives inside the object store (and, in the embedded case,
  inside your NestJS app) you already run.

For a public site, the pieces compose cleanly: the immutable, content-addressed
responses are exactly what a CDN wants, so putting Cloudflare or any caching
proxy in front gives you edge delivery while OpenBucket only ever renders each
variant once. For an internal tool or a moderate-traffic app, the on-disk cache
alone is plenty. If you're weighing the trade-offs, the
[Is OpenBucket for you?](/docs/is-openbucket-for-you) guide is deliberately
blunt about them.

## Next steps

- The full parameter and configuration reference:
  [image transforms guide](/docs/guides/image-transforms)
- Public buckets vs. presigned URLs: [sharing files](/docs/guides/sharing-files)
- Getting images in: [file uploads](/docs/guides/file-uploads)
- Every knob: [configuration reference](/docs/reference/configuration)

---

Built something with this — or hit a transform you wish existed? Tell us in
[Discussions](https://github.com/ProjectBay/openbucket/discussions). And if
"one original, infinite variants, zero invoices" is your kind of trade, a star
on [GitHub](https://github.com/ProjectBay/openbucket) helps the project reach
the next person shopping for a self-hosted Cloudinary alternative.
