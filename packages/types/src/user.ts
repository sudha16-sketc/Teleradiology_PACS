export type UserRole = 'ADMIN' | 'COORDINATOR' | 'RADIOLOGIST' | 'TECHNICIAN' | 'HOSPITAL_USER';

export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status?: UserStatus;
  phone?: string | null;
  organization?: string | null;
  licenseNumber?: string | null;
  requestedRole?: UserRole | null;
  rejectionReason?: string | null;
  approvedAt?: string | null;
  approvedById?: string | null;
  hospitalId?: string | null;
  subspecialty?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  hospitalId?: string | null;
}

export interface RegistrationRequest {
  id: string;
  email: string;
  displayName: string;
  phone?: string | null;
  organization?: string | null;
  licenseNumber?: string | null;
  requestedRole?: UserRole | null;
  role: UserRole;
  status: UserStatus;
  rejectionReason?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  approvedById?: string | null;
}