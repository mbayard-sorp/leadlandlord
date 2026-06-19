import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { BuildsellSite } from '@leadlandlord/db';

/**
 * Build & Sell invoice PDF.
 *
 * Uses @react-pdf/renderer — pure-JS, no headless browser — so it runs in the
 * serverless Node runtime (mark the calling route/action `runtime='nodejs'`).
 * Payment is collected out of band via the operator-pasted payment link; this
 * PDF just states the line item + embeds the link.
 */

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, color: '#1a1a1a', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
  brand: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#666' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  section: { marginTop: 24 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 6, marginBottom: 8 },
  cellDesc: { flex: 1 },
  cellAmt: { width: 100, textAlign: 'right' },
  row: { flexDirection: 'row', paddingVertical: 6 },
  totalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#ccc', marginTop: 8, paddingTop: 8 },
  bold: { fontFamily: 'Helvetica-Bold' },
  payBox: { marginTop: 32, padding: 16, backgroundColor: '#f4f7fa', borderRadius: 6 },
  link: { color: '#0e7490' },
  footer: { position: 'absolute', bottom: 40, left: 48, right: 48, fontSize: 9, color: '#999', textAlign: 'center' },
});

export function formatUsd(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

interface InvoiceProps {
  businessName: string;
  city: string;
  state: string;
  invoiceNumber: string;
  priceUsd: string;
  paymentLink: string;
  issueDate: string;
}

function InvoiceDocument(p: InvoiceProps) {
  return (
    <Document title={`Invoice ${p.invoiceNumber}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>LeadLandlord</Text>
            <Text style={styles.muted}>Custom website services</Text>
          </View>
          <View>
            <Text style={styles.bold}>INVOICE</Text>
            <Text style={styles.muted}>{p.invoiceNumber}</Text>
            <Text style={styles.muted}>{p.issueDate}</Text>
          </View>
        </View>

        <View>
          <Text style={styles.muted}>Billed to</Text>
          <Text style={styles.bold}>{p.businessName}</Text>
          <Text style={styles.muted}>{p.city}, {p.state}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.tableHead}>
            <Text style={[styles.cellDesc, styles.bold]}>Description</Text>
            <Text style={[styles.cellAmt, styles.bold]}>Amount</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cellDesc}>
              Custom single-page website — {p.businessName} ({p.city}, {p.state})
            </Text>
            <Text style={styles.cellAmt}>{formatUsd(p.priceUsd)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[styles.cellDesc, styles.bold]}>Total due</Text>
            <Text style={[styles.cellAmt, styles.bold]}>{formatUsd(p.priceUsd)}</Text>
          </View>
        </View>

        <View style={styles.payBox}>
          <Text style={styles.bold}>Pay online</Text>
          <Text style={styles.muted}>Use the secure link below to complete payment:</Text>
          <Text style={styles.link}>{p.paymentLink}</Text>
        </View>

        <Text style={styles.footer}>
          Thank you for your business. Questions? Just reply to the email this invoice came with.
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render the invoice PDF for a B&S site to a Buffer. Requires
 * `price_usd`, `payment_link`, and `invoice_number` to be set on the row.
 */
export async function buildInvoicePdf(
  site: Pick<BuildsellSite, 'businessName' | 'city' | 'state' | 'invoiceNumber' | 'priceUsd' | 'paymentLink'>,
  opts: { issueDate?: string } = {},
): Promise<Buffer> {
  if (!site.invoiceNumber || !site.priceUsd || !site.paymentLink) {
    throw new Error('buildInvoicePdf requires invoiceNumber, priceUsd, and paymentLink');
  }
  const issueDate =
    opts.issueDate ??
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return renderToBuffer(
    <InvoiceDocument
      businessName={site.businessName}
      city={site.city}
      state={site.state}
      invoiceNumber={site.invoiceNumber}
      priceUsd={site.priceUsd}
      paymentLink={site.paymentLink}
      issueDate={issueDate}
    />,
  );
}
