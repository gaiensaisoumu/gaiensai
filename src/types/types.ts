import type { TicketCardItem } from '../features/tickets/IssuedTicketCardList';

export type GalleryImage = {
  src: string;
  alt: string;
  width: number;
};

export type GalleryProps = {
  images: GalleryImage[];
};

export type Session = {
  user: {
    id: string;
    email?: string | null;
  };
} | null;

export type UserData = {
  email: string;
  affiliation: number;
  junior_usage_type?: number;
  application_day?: string | null;
} | null;

export type EventConfig = {
  site_url: string;
  year: number;
  name: string;
  school: string;
  operating_organization: string;
  catchCopy: string;
  meta_description: string;
  date: string[];
  date_length: number;
  grade_number: number;
  class_number: number;
  max_attendance_number: number;
  // performances_per_day: number;
  last_update: string | null;
};

export type Performance = {
  id: number;
  year: number;
  class_id: number;
  class_name: string;
  title: string;
  description: string;
  total_capacity: number;
  total_remaining: number;
};

export type AvailableSeatSelection = {
  performanceId: number;
  performanceName: string;
  scheduleId: number;
  scheduleName: string;
  remaining: number;
};
export type CachedTicketDisplay = TicketCardItem & {
  serial?: number;
};
