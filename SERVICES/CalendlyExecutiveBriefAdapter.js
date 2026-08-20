'use strict';

function attachMeetingPipelineToBrief(brief, pipeline) {
  const safeBrief =
    brief && typeof brief === 'object'
      ? { ...brief }
      : {};

  const healthy =
    pipeline?.ok === true;

  const metrics =
    healthy
      ? (pipeline.metrics || {})
      : {};

  const meetingPipeline = {
    status:
      healthy
        ? (pipeline.status || 'Healthy')
        : 'Critical',
    source: 'CALENDLY',
    generatedAt:
      pipeline?.generatedAt ||
      new Date().toISOString(),
    account:
      pipeline?.account ||
      null,
    metrics: {
      p2gcEvents:
        Number(metrics.p2gcEvents || 0),
      activeMeetings:
        Number(metrics.activeMeetings || 0),
      upcomingMeetings:
        Number(metrics.upcomingMeetings || 0),
      pastActiveMeetings:
        Number(metrics.pastActiveMeetings || 0),
      canceledMeetings:
        Number(metrics.canceledMeetings || 0)
    },
    upcomingMeetings:
      healthy && Array.isArray(pipeline.upcomingMeetings)
        ? pipeline.upcomingMeetings.slice(0, 10)
        : [],
    recentMeetings:
      healthy && Array.isArray(pipeline.recentMeetings)
        ? pipeline.recentMeetings.slice(0, 10)
        : [],
    error:
      healthy
        ? null
        : (pipeline?.error || pipeline?.status || 'Calendly revenue pipeline unavailable')
  };

  safeBrief.meetingPipeline =
    meetingPipeline;

  if (!Array.isArray(safeBrief.todayPriorities)) {
    safeBrief.todayPriorities = [];
  }

  let meetingPriority;

  if (healthy && meetingPipeline.metrics.upcomingMeetings > 0) {
    meetingPriority = {
      priority: 1,
      area: 'Revenue / Meetings',
      action: `Prepare for ${meetingPipeline.metrics.upcomingMeetings} upcoming P2GC prospect meeting(s).`,
      objective: 'Convert scheduled Federal Strategy Calls into qualified opportunities and proposals.',
      impact: 'Directly supports booked-meeting conversion and revenue.',
      owner: 'MILES',
      requiresKevin: true,
      source: 'CALENDLY'
    };
  } else if (healthy) {
    meetingPriority = {
      priority: 1,
      area: 'Revenue / Meetings',
      action: 'Restore upcoming qualified P2GC meeting inventory; Calendly currently has 0 upcoming meetings.',
      objective: 'Generate and book new Federal Strategy Calls from outbound and qualified lead sources.',
      impact: 'Restores the top-of-funnel activity required for near-term revenue.',
      owner: 'MILES',
      requiresKevin: false,
      source: 'CALENDLY'
    };
  } else {
    meetingPriority = {
      priority: 1,
      area: 'Revenue / Meetings',
      action: 'Repair Calendly meeting-pipeline visibility.',
      objective: 'Restore automated meeting visibility before revenue decisions are made from the executive brief.',
      impact: 'Prevents blind spots in booked-meeting and conversion reporting.',
      owner: 'MILES',
      requiresKevin: false,
      source: 'CALENDLY'
    };
  }

  safeBrief.todayPriorities = [
    meetingPriority,
    ...safeBrief.todayPriorities
  ];

  return safeBrief;
}

module.exports = {
  attachMeetingPipelineToBrief
};
