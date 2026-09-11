export interface ExistingRequirementDigest {
  id: string;
  title: string;
  summary: string;
  points: { id: string; title: string; status: string }[];
}
