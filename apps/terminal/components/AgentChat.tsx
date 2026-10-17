"use client";

import { AomiWidget } from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";

import { markWidgetLoaded } from "@/lib/agentGuard";

/* Module scope, on purpose: this runs the moment the vendor's code is in the
   tab, which is the fact the drawer's guard needs (lib/agentGuard.ts), whether
   or not anything rendered yet. */
markWidgetLoaded();

export default function AgentChat({
  applicationId,
}: {
  applicationId: number;
}) {
  return (
    <AomiWidget
      applicationId={applicationId}
      routing={{
        defaultMode: "direct",
        targets: [{ mode: "direct", apps: [{ applicationId }] }],
      }}
      theme="dark"
      className="acr-agent-widget"
      width="100%"
      height="100%"
      showSidebar={false}
      walletFamilies={["evm"]}
      features={{ library: false, theme: false }}
      persistThread
    />
  );
}
