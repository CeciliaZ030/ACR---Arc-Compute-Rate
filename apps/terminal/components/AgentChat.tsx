"use client";

import { AomiWidget } from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";

export default function AgentChat({
  applicationId,
}: {
  applicationId: number;
}) {
  return (
    <AomiWidget
      applicationId={applicationId}
      baseUrl="https://chat-staging.aomi.dev"
      clientOptions={{ apiKey: process.env.NEXT_PUBLIC_ACR_APP_KEY }}
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
