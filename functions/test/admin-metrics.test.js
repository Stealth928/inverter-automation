'use strict';

const {
  estimateFirestoreCostFromUsage,
  fetchCloudBillingCost,
  getRuntimeProjectId,
  listMonitoringTimeSeries,
  normalizeMetricErrorMessage,
  sumSeriesValues
} = require('../lib/admin-metrics');

describe('admin-metrics module', () => {
  test('getRuntimeProjectId resolves from admin app options', () => {
    const previousGcloudProject = process.env.GCLOUD_PROJECT;
    const previousGcpProject = process.env.GCP_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GCP_PROJECT;

    const admin = {
      app: jest.fn(() => ({ options: { projectId: 'proj-123' } }))
    };

    try {
      const result = getRuntimeProjectId(admin);
      expect(result).toBe('proj-123');
    } finally {
      if (previousGcloudProject == null) {
        delete process.env.GCLOUD_PROJECT;
      } else {
        process.env.GCLOUD_PROJECT = previousGcloudProject;
      }
      if (previousGcpProject == null) {
        delete process.env.GCP_PROJECT;
      } else {
        process.env.GCP_PROJECT = previousGcpProject;
      }
    }
  });

  test('listMonitoringTimeSeries aggregates across pages and series', async () => {
    const list = jest.fn()
      .mockResolvedValueOnce({
        data: {
          nextPageToken: 'page-2',
          timeSeries: [
            {
              points: [
                { interval: { endTime: '2026-03-06T00:00:00.000Z' }, value: { int64Value: '2' } },
                { interval: { endTime: '2026-03-06T01:00:00.000Z' }, value: { doubleValue: 1.5 } }
              ]
            },
            {
              points: [
                { interval: { endTime: '2026-03-06T01:00:00.000Z' }, value: { int64Value: '3' } }
              ]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          timeSeries: [
            {
              points: [
                { interval: { endTime: '2026-03-06T02:00:00.000Z' }, value: { distributionValue: { count: 4 } } }
              ]
            }
          ]
        }
      });

    const monitoring = {
      projects: {
        timeSeries: { list }
      }
    };

    const series = await listMonitoringTimeSeries({
      monitoring,
      projectId: 'project-id',
      filter: 'metric.type="x"',
      startTime: new Date('2026-03-06T00:00:00.000Z'),
      endTime: new Date('2026-03-06T03:00:00.000Z'),
      aligner: 'ALIGN_DELTA',
      alignmentPeriod: '3600s'
    });

    expect(series).toEqual([
      { timestamp: '2026-03-06T00:00:00.000Z', value: 2 },
      { timestamp: '2026-03-06T01:00:00.000Z', value: 4.5 },
      { timestamp: '2026-03-06T02:00:00.000Z', value: 4 }
    ]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  test('sumSeriesValues adds numeric values safely', () => {
    const result = sumSeriesValues([
      { value: 1 },
      { value: '2.5' },
      { value: null },
      { value: 'abc' }
    ]);

    expect(result).toBe(3.5);
  });

  test('normalizeMetricErrorMessage strips delayed-metric suffix', () => {
    const msg = normalizeMetricErrorMessage(
      'Cannot find metric(s) that match type. If a metric was created recently, it may take a few minutes.'
    );

    expect(msg).toBe('Cannot find metric(s) that match type.');
  });

  test('estimateFirestoreCostFromUsage applies free-tier offsets', () => {
    const now = new Date(Date.UTC(2026, 2, 10));
    const result = estimateFirestoreCostFromUsage(600000, 300000, 250000, now);

    expect(result.isEstimate).toBe(true);
    expect(result.services).toHaveLength(3);
    expect(result.totalUsd).toBeGreaterThan(0);
  });

  test('fetchCloudBillingCost throws when googleapis dependency is missing', async () => {
    await expect(fetchCloudBillingCost('project-id')).rejects.toThrow('googleapis not available');
  });
});
