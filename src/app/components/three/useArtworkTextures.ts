import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { SRGBColorSpace, Texture, TextureLoader } from "three";
import type { AssetBlobTier } from "../../../domain/repositories/assetRepository";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";

// Display-tier textures for artwork planes by default (spec §6.3). Builds on
// useAssetImageUrls (which owns the object-URL lifecycle) and owns the GPU
// half: one THREE.Texture per assetId, disposed when the asset drops out of
// the scene, when its URL is replaced, or when the view unmounts. Stale async
// loads (resolving after unmount or after the assetId's URL changed) are
// disposed instead of cached. Must be called inside <Canvas>.
export function useArtworkTextures(
  assetIds: (string | undefined)[],
  getBlob: (key: string) => Promise<Blob>,
  tier: AssetBlobTier = "display"
): Map<string, Texture> {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const urlsByAssetId = useAssetImageUrls(assetIds, getBlob, tier);

  const [texturesByAssetId, setTexturesByAssetId] = useState<Map<string, Texture>>(
    () => new Map()
  );

  // Which URL each cached texture was loaded from — a texture is stale when
  // its asset's URL changed (tier refetch, asset re-import), not only when
  // the asset disappears.
  const loadedUrlByAssetId = useRef(new Map<string, string>());
  const texturesRef = useRef(texturesByAssetId);
  texturesRef.current = texturesByAssetId;

  useEffect(() => {
    let cancelled = false;
    const loader = new TextureLoader();

    // Drop textures whose asset left the scene or whose URL was replaced.
    setTexturesByAssetId((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [assetId, texture] of current) {
        if (urlsByAssetId.get(assetId) !== loadedUrlByAssetId.current.get(assetId)) {
          texture.dispose();
          next.delete(assetId);
          loadedUrlByAssetId.current.delete(assetId);
          changed = true;
        }
      }
      return changed ? next : current;
    });

    for (const [assetId, url] of urlsByAssetId) {
      if (loadedUrlByAssetId.current.get(assetId) === url) continue;

      loader
        .loadAsync(url)
        .then((texture) => {
          if (cancelled || urlsByAssetId.get(assetId) !== url) {
            // The effect re-ran (or the view unmounted) while this load was
            // in flight — nothing will ever dispose it from state, so do it
            // here.
            texture.dispose();
            return;
          }
          // Faithful image color (spec §6.2) + legibility at oblique
          // eye-level angles (spec §6.3).
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());

          setTexturesByAssetId((current) => {
            const previous = current.get(assetId);
            if (previous) previous.dispose();
            const next = new Map(current);
            next.set(assetId, texture);
            return next;
          });
          loadedUrlByAssetId.current.set(assetId, url);
          // demand frameloop: a texture arriving must trigger a repaint.
          invalidate();
        })
        .catch(() => {
          // Failed loads just leave the plane on its placeholder material.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [urlsByAssetId, gl, invalidate]);

  // Unmount: release every cached texture's GPU memory.
  useEffect(() => {
    return () => {
      for (const texture of texturesRef.current.values()) {
        texture.dispose();
      }
    };
  }, []);

  return texturesByAssetId;
}
