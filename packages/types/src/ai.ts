export type AIJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type AITaskType = 'ANATOMY_DETECTION' | 'PATHOLOGY_SCREENING' | 'MEASUREMENT' | 'COMPARISON';

export interface AIJob {
  id: string;
  studyInstanceUid: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  taskType: AITaskType;
  status: AIJobStatus;
  result?: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}
