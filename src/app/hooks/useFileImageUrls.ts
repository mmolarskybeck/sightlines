import { useEffect, useState } from "react";

// Owns preview object URLs for unpersisted import files.
export function useFileImageUrls(imageFiles: File[]): Map<string, string> {
  const [urlsByFileName, setUrlsByFileName] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    // File-name keys are last-wins, matching the domain importer.
    const next = new Map<string, string>();
    for (const file of imageFiles) {
      next.set(file.name, URL.createObjectURL(file));
    }
    setUrlsByFileName(next);

    return () => {
      for (const url of next.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [imageFiles]);

  return urlsByFileName;
}
