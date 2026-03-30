import {
  buildAiSessionInsights,
  buildAiSyncNotice,
  buildToolUseNotice,
  isMutatingAiTool,
} from '@repo/shared';

describe('AI assistant helpers', () => {
  it('builds local-only sync notice', () => {
    expect(buildAiSyncNotice(false)).toContain('stanna lokalt');
  });

  it('describes read-only tool use', () => {
    expect(buildToolUseNotice(true, 'read-only')).toContain('läsläge');
  });

  it('classifies mutating tools', () => {
    expect(isMutatingAiTool('create_task')).toBe(true);
    expect(isMutatingAiTool('list_tasks')).toBe(false);
    expect(isMutatingAiTool('mcp_call_tool')).toBe(true);
  });

  it('builds session insights with local encrypted mode', () => {
    const insights = buildAiSessionInsights({
      providerLabel: 'MLC',
      modelLabel: 'model.bin',
      syncEnabled: false,
      toolUseEnabled: true,
      toolAccessMode: 'read-only',
      promptPreset: 'balanced',
      enabledMcpServices: ['filesystem'],
    });
    expect(insights.find((item) => item.id === 'sync')?.value).toContain('lokal');
    expect(insights.find((item) => item.id === 'tools')?.value).toContain('läsläge');
  });
});
