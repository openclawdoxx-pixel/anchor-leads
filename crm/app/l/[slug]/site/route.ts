import { applyLeadBasics, getTemplate } from "@/lib/funnel/render";
import { lookupLead } from "../_lookup";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const lead = await lookupLead(slug);
  if (!lead) return new Response("Not Found", { status: 404 });

  const html = applyLeadBasics(getTemplate(), lead);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
