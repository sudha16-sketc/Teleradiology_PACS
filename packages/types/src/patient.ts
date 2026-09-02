export interface Patient {
  patientId: string;
  displayName: string;
  dateOfBirth?: string;
  gender?: 'M' | 'F' | 'O' | 'U';
  hospitalId: string;
}
