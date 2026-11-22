import 'reflect-metadata';
import { compensateNewlyStoredInstances } from '../src/dicom/dicom.service.js';

describe('Orthanc partial-ingest compensation', () => {
  it('deletes instance 1 when instance 2 of 3 fails', async () => {
    const deleted: string[] = [];
    const statuses = ['Success', 'Failure', 'NotAttempted'];
    const ids = ['instance-1', 'instance-2', 'instance-3'];
    const newlyStored: string[] = [];

    try {
      statuses.forEach((status, index) => {
        if (status === 'Failure') throw new Error('forced second instance failure');
        if (status === 'Success') newlyStored.push(ids[index]);
      });
    } catch {
      await compensateNewlyStoredInstances(
        newlyStored,
        async (instanceId) => {
          deleted.push(instanceId);
        },
      );
    }

    expect(deleted).toEqual(['instance-1']);
  });

  it('never deletes an instance that was AlreadyStored', async () => {
    const deleted: string[] = [];
    const newlyStored = ['instance-2'];
    const alreadyStored = ['instance-1'];

    await compensateNewlyStoredInstances(
      newlyStored,
      async (instanceId) => {
        deleted.push(instanceId);
      },
    );

    expect(deleted).toEqual(['instance-2']);
    expect(deleted).not.toContain(alreadyStored[0]);
  });

  it('continues compensation if deleting one instance fails', async () => {
    const deleted: string[] = [];
    const failures: string[] = [];

    await compensateNewlyStoredInstances(
      ['instance-1', 'instance-2'],
      async (instanceId) => {
        if (instanceId === 'instance-1') throw new Error('delete failed');
        deleted.push(instanceId);
      },
      (instanceId) => failures.push(instanceId),
    );

    expect(failures).toEqual(['instance-1']);
    expect(deleted).toEqual(['instance-2']);
  });
});
