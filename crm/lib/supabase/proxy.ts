import { NextResponse, type NextRequest } from 'next/server';

// Auth temporarily disabled — the CRM is public for now. Leads are
// already public business info so there's no risk. Re-add session
// gating later when we want real team logins.
export async function updateSession(_request: NextRequest) {
  return NextResponse.next();
}
