import { notFound } from "next/navigation";
import leadsJson from "./leads.json";

type Lead = {
  company_name: string;
  owner_name: string;
  city: string;
  state: string;
  phone: string;
};

const leads = leadsJson as Record<string, Lead>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lead = leads[slug];
  if (!lead) return { title: "Anchor Frame" };
  return {
    title: `A new website for ${lead.company_name} — Anchor Frame`,
    description: `Built in the last 24 hours for ${lead.owner_name} at ${lead.company_name} in ${lead.city}, ${lead.state}.`,
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lead = leads[slug];
  if (!lead) notFound();

  return (
    <main style={{ margin: 0, padding: 0, background: "#0a1628" }}>
      <PersonalizedBanner lead={lead} slug={slug} />

      <iframe
        src="/templates/plumber-homepage.html"
        title={`${lead.company_name} — Homepage Preview`}
        style={{
          display: "block",
          width: "100%",
          height: "100vh",
          border: 0,
        }}
      />

      <iframe
        src="/templates/anchor-offer.html"
        title="The Anchor Zero Plan"
        style={{
          display: "block",
          width: "100%",
          height: "100vh",
          border: 0,
        }}
      />
    </main>
  );
}

function PersonalizedBanner({ lead, slug }: { lead: Lead; slug: string }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg,#0a1628 0%,#102840 100%)",
        color: "#fff",
        padding: "32px 24px",
        textAlign: "center",
        fontFamily:
          "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
      }}
    >
      <p
        style={{
          margin: "0 0 6px",
          fontSize: 13,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#2db4ff",
          fontWeight: 600,
        }}
      >
        Built in the last 24 hours for
      </p>
      <h1
        style={{
          margin: "0 0 4px",
          fontSize: "clamp(28px,4vw,42px)",
          fontWeight: 800,
          letterSpacing: "-0.01em",
        }}
      >
        {lead.owner_name} at {lead.company_name}
      </h1>
      <p style={{ margin: 0, color: "#cfe8ff", fontSize: 16 }}>
        Serving {lead.city}, {lead.state} · {lead.phone}
      </p>
      <p
        style={{
          marginTop: 14,
          fontSize: 12,
          color: "#5a6a80",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        slug: {slug}
      </p>
    </div>
  );
}
