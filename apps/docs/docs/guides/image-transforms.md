---
title: Image transforms
description: Resize, crop, and re-encode images on the fly with GET query params — cached, bounded, and safe by default.
sidebar_position: 2
---

# Image transforms

Serve a thumbnail, a WebP, or a cropped hero from the **same object** by adding query params to its GET URL. OpenBucket decodes, resizes, and re-encodes on the fly, then caches the result forever.

## Get a 400px WebP

Append transform params to any authorized object GET:

```
GET /uploads/photo.jpg?w=400&format=webp
```

That returns `photo.jpg` resized to 400px wide and re-encoded as WebP. The result is content-addressed and served with `Cache-Control: public, max-age=31536000, immutable`, so browsers and CDNs cache it indefinitely.

:::info[Transforms run on the GET route]
The transform happens on an authorized S3 GET, not through `getObjectStream`. The simplest way to use it from an `<img>` tag is a public-read bucket — see [gotchas](#gotchas) below and [Sharing files](./sharing-files.md#permanent-links-public-buckets).
:::

## The query params

| Param | Meaning | Values | Default |
| --- | --- | --- | --- |
| `w` | Target width in pixels | `1 … 4096` | — |
| `h` | Target height in pixels | `1 … 4096` | — |
| `fit` | How to fit within `w`/`h` | `cover`, `contain`, `fill`, `inside`, `outside` | `cover` |
| `format` | Re-encode to this format | `webp`, `jpeg`, `png`, `avif` | native (source format) |
| `q` | Encode quality | `1 … 100` | `80` |

A request counts as a transform when at least one of `w`, `h`, or `format` is present. Omit `format` and the image re-encodes in its native format at the requested size. Omit `w` and `h` and the image keeps its dimensions but re-encodes (handy for a plain `?format=webp`).

```
?w=800&h=600&fit=contain        # fit inside an 800×600 box, no crop
?w=200&h=200&fit=cover          # square crop to 200×200 (default fit)
?format=avif&q=60               # same size, AVIF at quality 60
?h=1080&format=webp             # 1080px tall WebP
```

Upscaling is disabled — a source smaller than the requested size is returned at its own size, never enlarged. EXIF orientation is honored (the image is auto-rotated).

## Allowed source formats

Only these raster types are decoded and re-encoded:

`image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif`, `image/tiff`

Everything else — including `image/svg+xml` — passes straight through to the normal, header-neutralized GET, untouched. SVG is deliberately excluded (it is an active-content / XXE surface). Output formats are limited to `webp`, `jpeg`, `png`, and `avif`.

## Caching

Each derivative is keyed by the source object's ETag plus the exact transform params, so:

- the first request produces and caches the derivative; subsequent identical requests are served from the cache;
- the response `ETag` is the derivative's content hash, so a browser `If-None-Match` gets a `304 Not Modified` with no work;
- when the source object changes, its ETag changes, so the derivative URL naturally points at a fresh render (no manual cache-busting).

A cold-cache stampede is collapsed by single-flight (one decode, shared result), and transforms are served whole with `Accept-Ranges: none`.

## Configuration & DoS bounds

Transforms are **on by default** and every knob is a safety bound. In the standalone app these are env vars; embedded library hosts inherit the same defaults.

| Env var | Default | What it bounds |
| --- | --- | --- |
| `IMAGE_TRANSFORM_ENABLED` | `true` | Master on/off switch. |
| `MAX_TRANSFORM_DIMENSION` | `4096` | Max `w`/`h` — bounds the output canvas before any decode. |
| `MAX_TRANSFORM_INPUT_BYTES` | `52428800` (50 MiB) | Refuses an oversized source before buffering a byte. |
| `IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS` | `576000000` (24000×24000) | Turns a decompression bomb into a `400`. |
| `IMAGE_TRANSFORM_CONCURRENCY` | `4` | Caps concurrent decodes; the rest queue. |
| `DERIVATIVE_CACHE_MAX_BYTES` | `5368709120` (5 GiB) | Cap on the on-disk derivative cache. |

Defense in depth is layered: the param parser bounds the canvas before decode, an input-byte cap refuses oversized sources, `limitInputPixels` stops decompression bombs, a counting semaphore caps parallelism, and the per-IP request throttle sits in front of all of it.

:::warning[Bad input is always a 400, never a 500]
An out-of-range dimension, an unknown format, a too-large source, or an undecodable image all return an S3-style `400` — never a `500` or an OOM. Authorization is unchanged: a transform request runs through the same `s3:GetObject` checks as a plain GET.
:::

## Gotchas

:::warning[You can't append params to a presigned URL]
A presigned URL signs its entire query string. Tacking `?w=400` onto a minted presigned GET breaks the signature and the request is rejected. To use transforms, either:

- serve from a **public-read bucket** so an anonymous `<img src>` GET works directly, or
- issue a fully SigV4-signed request that includes the transform params (an S3 SDK with the params baked into the signed request).

The public-bucket route is the usual choice for `<img>` tags. See [Sharing files](./sharing-files.md#permanent-links-public-buckets).
:::

:::note[Non-images just pass through]
If the object isn't an allow-listed raster type (or is an SVG), the transform params are ignored and the original bytes are served with the usual safe response headers. No error.
:::

## Next steps

- [Sharing files](./sharing-files.md) — public buckets and presigned URLs for serving images.
- [File uploads](./file-uploads.md) — get images into the store in the first place.
- [NestJS module reference](../reference/nestjs-module.md) — full configuration.
