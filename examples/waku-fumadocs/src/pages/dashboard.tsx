import Page from '@/app/dashboard/page';

export default function Dashboard() {
  return <Page />;
}

export async function getConfig() {
  return {
    render: 'static',
  } as const;
}
