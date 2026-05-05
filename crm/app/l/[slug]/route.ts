import { applyDiffs, applyLeadBasics, getTemplate } from "@/lib/funnel/render";
import { lookupLead } from "./_lookup";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const found = await lookupLead(slug);
  if (!found) return new Response("Not Found", { status: 404 });

  let html = applyLeadBasics(getTemplate(), found.lead);
  if (found.personalization) {
    html = applyDiffs(html, found.personalization);
  }
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
