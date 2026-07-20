import { useState } from "react";
import { Button } from "../ui/button";

export function PrivacyConsentNotice({
  undecided,
  onAllow,
  onDecline
}: {
  undecided: boolean;
  onAllow: () => boolean;
  onDecline: () => boolean;
}) {
  const [saveFailed, setSaveFailed] = useState(false);

  if (!undecided) return null;

  const saveChoice = (save: () => boolean) => {
    setSaveFailed(!save());
  };

  return (
    <aside
      aria-labelledby="privacy-consent-title"
      className="privacy-consent-notice"
    >
      <div className="privacy-consent-copy">
        <h2 id="privacy-consent-title">Help improve Sightlines</h2>
        <p>
          Sightlines can send anonymous usage, performance, and technical error
          information so we can understand which features are useful and where the app
          needs work. We never collect project content, artwork information, images,
          files, filenames, or Dropbox data.
        </p>
        {saveFailed ? (
          <p className="privacy-consent-error" role="alert">
            Your choice could not be saved. Anonymous reporting remains off.
          </p>
        ) : null}
      </div>
      <div className="privacy-consent-actions">
        <Button variant="outline" onClick={() => saveChoice(onAllow)}>
          Allow anonymous reporting
        </Button>
        <Button variant="outline" onClick={() => saveChoice(onDecline)}>
          No thanks
        </Button>
        <a href="https://sightlines.art/privacy">Learn more</a>
      </div>
    </aside>
  );
}
