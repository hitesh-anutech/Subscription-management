import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchResult {
  type: 'lead' | 'quote' | 'subscription' | 'domain' | 'customer';
  id: string;
  title: string;
  subtitle: string;
  status?: string;
  href: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, limit = 15): Promise<SearchResult[]> {
    if (!q || q.trim().length < 2) return [];

    const term = q.trim();
    const perType = Math.ceil(limit / 4);

    const [leads, quotes, subscriptions, domains, customers] = await Promise.all([
      // Leads
      this.prisma.lead.findMany({
        where: {
          OR: [
            { companyName:   { contains: term, mode: 'insensitive' } },
            { contactName:   { contains: term, mode: 'insensitive' } },
            { email:         { contains: term, mode: 'insensitive' } },
            { primaryDomain: { contains: term, mode: 'insensitive' } },
            { gstin:         { contains: term, mode: 'insensitive' } },
            { leadNumber:    { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true, leadNumber: true, companyName: true, email: true, status: true },
        take: perType,
      }),

      // Quick Quotes
      this.prisma.quickQuote.findMany({
        where: {
          OR: [
            { quoteNumber:       { contains: term, mode: 'insensitive' } },
            { zohoCustomerName:  { contains: term, mode: 'insensitive' } },
            { lead: { companyName: { contains: term, mode: 'insensitive' } } },
          ],
        },
        select: { id: true, quoteNumber: true, zohoCustomerName: true, status: true, totalAmount: true,
                  lead: { select: { companyName: true } } },
        take: perType,
      }),

      // Subscriptions
      this.prisma.subscription.findMany({
        where: {
          OR: [
            { subscriptionNumber: { contains: term, mode: 'insensitive' } },
            { zohoCustomerName:   { contains: term, mode: 'insensitive' } },
            { zohoItemName:       { contains: term, mode: 'insensitive' } },
            { domain: { domainName: { contains: term, mode: 'insensitive' } } },
          ],
        },
        select: { id: true, subscriptionNumber: true, zohoCustomerName: true,
                  zohoItemName: true, lifecycleStatus: true,
                  domain: { select: { domainName: true } } },
        take: perType,
      }),

      // Domains
      this.prisma.domain.findMany({
        where: {
          OR: [
            { domainName:       { contains: term, mode: 'insensitive' } },
            { zohoCustomerName: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true, domainName: true, zohoCustomerName: true, status: true },
        take: perType,
      }),

      // Zoho cache (customers)
      this.prisma.zohoCache.findMany({
        where: {
          entityType: 'customer',
          OR: [
            { displayName: { contains: term, mode: 'insensitive' } },
            { email:       { contains: term, mode: 'insensitive' } },
            { gstin:       { contains: term, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true, zohoId: true, displayName: true, email: true,
          organization: { select: { name: true } },
        },
        take: perType,
      }),
    ]);

    const results: SearchResult[] = [
      ...leads.map((l) => ({
        type: 'lead' as const,
        id: l.id,
        title: l.companyName,
        subtitle: `${l.leadNumber} · ${l.email}`,
        status: l.status,
        href: `/dashboard/leads/${l.id}`,
      })),
      ...quotes.map((q) => ({
        type: 'quote' as const,
        id: q.id,
        title: q.zohoCustomerName ?? q.lead?.companyName ?? 'Quote',
        subtitle: `${q.quoteNumber} · ₹${Number(q.totalAmount).toLocaleString('en-IN')}`,
        status: q.status,
        href: `/dashboard/quick-quotes/${q.id}`,
      })),
      ...subscriptions.map((s) => ({
        type: 'subscription' as const,
        id: s.id,
        title: s.zohoCustomerName ?? s.zohoItemName ?? 'Subscription',
        subtitle: `${s.subscriptionNumber} · ${s.domain.domainName}`,
        status: s.lifecycleStatus,
        href: `/dashboard/subscriptions/${s.id}`,
      })),
      ...domains.map((d) => ({
        type: 'domain' as const,
        id: d.id,
        title: d.domainName,
        subtitle: d.zohoCustomerName ?? '',
        status: d.status,
        href: `/dashboard/domains`,
      })),
      ...customers.map((c) => ({
        type: 'customer' as const,
        id: c.id,
        title: c.displayName ?? c.zohoId,
        subtitle: `${c.email ?? ''} · ${(c as { organization?: { name?: string } }).organization?.name ?? ''}`,
        href: `/dashboard/domains`,
      })),
    ];

    return results.slice(0, limit);
  }
}
