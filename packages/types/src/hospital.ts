export interface Hospital {
  id: string;
  name: string;
  code: string;
  address?: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
}

export interface Site {
  id: string;
  hospitalId: string;
  name: string;
  code: string;
  isActive: boolean;
}
