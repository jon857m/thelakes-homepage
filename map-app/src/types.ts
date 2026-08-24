export type Business = {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  category: string;
  latitude: number;
  longitude: number;
  town: string;
  address?: string;
  postcode?: string;
  websiteUrl?: string;
  directionsUrl?: string;
  imageUrl?: string;
  featured: boolean;
};

export type CameraState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export type SharedLocation = CameraState & {
  shortCode: string;
  expiresAt?: string;
};

export type PinLocation = { latitude: number; longitude: number };
