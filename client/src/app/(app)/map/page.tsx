import VenueMap from '@/components/map/VenueMap';
import { PageHeader } from '@/components/ui/surface';

export default function MapPage() {
  return (
    <>
      <PageHeader
        kicker="Venues on campus"
        title={
          <>
            Where it&apos;s <em>at</em>
          </>
        }
        description="Every venue with something coming up, and what’s on there."
      />
      <VenueMap className="lg:min-h-[640px]" />
    </>
  );
}
