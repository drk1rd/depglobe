export type Ecosystem =
  | 'npm' | 'pypi' | 'go' | 'maven' | 'cargo' | 'nuget' | 'rubygems' | 'composer' | 'actions' | 'other';

export interface Place {
  id: string;
  label: string; // "Berlin, Germany" or "Germany"
  cc: string; // ISO alpha-2
  country: string;
  flag: string;
  lat: number;
  lng: number;
  precision: 'city' | 'country';
}

export interface Entity {
  login: string;
  kind: 'User' | 'Organization';
  name?: string;
  avatar?: string;
  location?: string; // raw free text from GitHub
  placeId?: string;
}

export interface Pkg {
  id: string; // ecosystem:name
  ecosystem: Ecosystem;
  name: string;
  version: string;
  direct: boolean;
  repo?: string; // owner/name on github.com
  scorecard?: number;
  stars?: number;
  archived?: boolean;
  pushedAt?: string;
  humans?: number; // distinct human committers across recent commits
  entities: string[]; // logins: owner + top committers
}

export interface Result {
  repo: string;
  generatedAt: string;
  mode: 'token' | 'open' | 'anon'; // GitHub GraphQL | ecosyste.ms | GitHub REST owners only
  sbomTotal: number;
  capped: boolean;
  hq?: { login: string; placeId: string };
  packages: Pkg[];
  entities: Record<string, Entity>;
  places: Record<string, Place>;
}

export type Stage = 'sbom' | 'resolve' | 'people' | 'geo' | 'done';

export interface Progress {
  stage: Stage;
  message: string;
  done?: number;
  total?: number;
}
