export interface TATDistribution {
  range: string;
  count: number;
  percentage: number;
}

export interface ModalityDistribution {
  modality: string;
  count: number;
  percentage: number;
}

export interface HospitalPerformance {
  hospitalId: string;
  hospitalName: string;
  totalStudies: number;
  averageTAT: number;
  slaCompliance: number;
  deliverySuccessRate: number;
}

export interface BacklogData {
  date: string;
  new: number;
  assigned: number;
  reading: number;
  completed: number;
}

export interface SLABreachData {
  studyUid: string;
  patientName: string;
  modality: string;
  hospital: string;
  deadline: string;
  overdueMinutes: number;
  priority: string;
}

export interface AnalyticsOverview {
  totalStudies: number;
  studiesToday: number;
  averageTAT: number;
  slaComplianceRate: number;
  backlogCount: number;
  deliverySuccessRate: number;
}
