export type ImagingAvailability =
  | 'PENDING'
  | 'AVAILABLE'
  | 'MISSING'
  | 'UNAVAILABLE'
  | 'INCOMPLETE';

export interface ImagingAvailabilityResult {
  studyInstanceUid: string;
  state: ImagingAvailability;
  reason: string;
  checkedAt: string;
  expectedSeriesCount: number;
  actualSeriesCount: number;
  expectedInstanceCount: number;
  actualInstanceCount: number;
  missingSeriesUids: string[];
  missingInstanceUids: string[];
}
