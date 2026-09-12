---
name: TMDB poster proxying
description: Durable constraints for loading TMDB artwork from Expo through the Replit API.
---

The Expo image loader should normalize every TMDB `poster_path` into a direct `https://image.tmdb.org/t/p/<size>/<path>` URL, then try the Replit `/api/image?url=<encodeURIComponent(fullUrl)>` proxy before direct TMDB and wsrv.nl.

**Why:** A proxy URL built from only the path, or a proxy chain that starts with an external CDN, can produce dark placeholder cards even when TMDB JSON is healthy.

**How to apply:** Keep the API host resolved from the Replit-injected public domain, log the endpoint/result/poster transition, and verify the image proxy returns actual image bytes with the upstream content type.