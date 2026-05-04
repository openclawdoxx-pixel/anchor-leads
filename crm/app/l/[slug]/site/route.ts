import { applyLeadBasics, getTemplate } from "@/lib/funnel/render";
import leadsJson from "../leads.json";

type Lead = {
  company_name: string;
  owner_name?: string | null;
  city: string;
  state: string;
  phone: string;
};

const leads = leadsJson as Record<string, Lead>;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const lead = leads[slug];
  if (!lead) return new Response("Not Found", { status: 404 });

  const html = applyLeadBasics(getTemplate(), lead);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
