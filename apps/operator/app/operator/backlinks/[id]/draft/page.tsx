import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DraftRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/operator/links/${id}/draft`);
}
