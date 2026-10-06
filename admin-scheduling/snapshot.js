/* Schedule presets; staff, locations and shifts load from the live service. */
window.ScheduleMock = {TODAY:"",WEEK:[],EMPLOYEES:{},LOCATIONS:[],PRESETS:{
    opening: { label: 'Opening', start: '09:30', end: '18:30' },
    adjustedOpening: { label: 'Adjusted Opening', start: '10:30', end: '19:30' },
    midshift: { label: 'Midshift', start: '11:00', end: '20:00' },
    closing: { label: 'Closing', start: '13:00', end: '22:00' },
    closingHalf: { label: 'Closing Half-Day', start: '18:00', end: '22:00' },
    custom: { label: 'Custom', start: null, end: null }
  }};
