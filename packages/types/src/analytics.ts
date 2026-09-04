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

/** Operational pipeline counts + SLA breach metrics for the dashboard. */
export interface SlaBreachItem {
  studyId: string;
  studyInstanceUid: string;
  patientName: string;
  modality: string;
  hospitalName: string;
  priority: string;
  status: string;
  slaDeadline?: string | null;
  overdueMinutes: number;
}

export interface OperationalOverview {
  counts: {
    unassigned: number;
    assigned: number;
    inReading: number;
    reportDraft: number;
    awaitingReview: number;
    awaitingDelivery: number;
    hospitalReview: number;
    correctionQueue: number;
    completed: number;
    total: number;
  };
  tat: {
    averageReportingMinutes: number;
    averageTotalMinutes: number;
  };
  sla: {
    breachCount: number;
    totalTracked: number;
    breachPercentage: number;
    breaches: SlaBreachItem[];
  };
}

