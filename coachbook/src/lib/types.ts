export type UserRole = "coach" | "parent" | "admin";
export type ServiceType = "one_to_one" | "group" | "camp";

export type Profile = { id: string; role: UserRole; full_name: string | null; phone: string | null };

export type Coach = {
  id: string;
  profile_id: string;
  business_name: string;
  slug: string;
  bio: string | null;
  photo_url: string | null;
  postcode: string | null;
  qualifications: string | null;
  dbs_checked: boolean;
  dbs_date: string | null;
  published: boolean;
  subscription_status: string;
};

export type PublicCoach = Pick<
  Coach,
  "id" | "business_name" | "slug" | "bio" | "photo_url" | "postcode" | "qualifications" | "dbs_checked" | "dbs_date"
>;

export type Service = {
  id: string;
  coach_id: string;
  name: string;
  description: string | null;
  type: ServiceType;
  duration_minutes: number;
  price_pence: number;
  max_participants: number;
  location: string | null;
  active: boolean;
};

export type AvailabilityRule = {
  id: string;
  coach_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  location: string | null;
};

export type AvailabilityException = {
  id: string;
  coach_id: string;
  date: string;
  kind: "blocked" | "extra";
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  note: string | null;
};

export type Player = {
  id: string;
  parent_profile_id: string;
  first_name: string;
  age_group: string;
  notes: string | null;
  parental_consent_at: string | null;
};

export type ActionState = { error?: string; success?: string } | undefined;
