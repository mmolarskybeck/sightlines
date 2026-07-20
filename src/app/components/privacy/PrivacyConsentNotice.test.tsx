import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyConsentNotice } from "./PrivacyConsentNotice";

afterEach(cleanup);

describe("PrivacyConsentNotice", () => {
  it("shows the neutral notice only while a choice is undecided", () => {
    const { rerender } = render(
      <PrivacyConsentNotice undecided onAllow={() => true} onDecline={() => true} />
    );
    expect(screen.getByRole("complementary", { name: "Help improve Sightlines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "https://sightlines.art/privacy"
    );

    rerender(
      <PrivacyConsentNotice undecided={false} onAllow={() => true} onDecline={() => true} />
    );
    expect(screen.queryByText("Help improve Sightlines")).not.toBeInTheDocument();
  });

  it("offers equal allow and decline actions", () => {
    const onAllow = vi.fn(() => true);
    const onDecline = vi.fn(() => true);
    render(<PrivacyConsentNotice undecided onAllow={onAllow} onDecline={onDecline} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow anonymous reporting" }));
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("reports a failed save and explains that reporting remains off", () => {
    render(
      <PrivacyConsentNotice undecided onAllow={() => false} onDecline={() => true} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow anonymous reporting" }));
    expect(screen.getByRole("alert")).toHaveTextContent("reporting remains off");
  });
});
