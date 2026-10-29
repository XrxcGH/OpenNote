// checks-disable-file modifiability: one catalog of the kit's strings, one namespace for the whole kit
// The history, places, languages, and texts kit: timelines, calendars, maps, coordinates, scripts, linguistics, text
// analysis, identification keys, and note frames. Every interface string is a full sentence, never joined from
// pieces. A note frame's outline is one string in the frame line language (features/tools/humanities/frames).

export const kitHumanities = {
  title: 'History, places, languages, and texts',
  open: 'Open the history, places, languages, and texts kit',
  keywords: 'humanities history geography languages linguistics literature calendar map timeline frames',
  toolsLabel: 'Tools in this kit',
  common: {
    steps: 'Steps',
    results: 'Results',
    insertGroup: 'Put the result on the page',
    insertAnswer: 'Insert answer',
    insertTable: 'Insert table',
    insertSteps: 'Insert steps',
    insertLatex: 'Insert LaTeX',
    insertPicture: 'Insert picture',
    inserted: 'Added to the page.',
    noPage: 'Click in a page first, then insert.',
    source: 'Source: {source}',
    quantity: 'Quantity',
    value: 'Value',
  },
  frames: {
    title: 'Note frames',
    open: 'Insert a note frame',
    keywords: 'note frame outline template structure case brief memo essay planner lab report field notes',
    search: 'Search frames',
    group: 'Subject',
    all: 'All subjects',
    list: 'Frames',
    preview: 'Preview of {name}',
    insert: 'Insert frame',
    none: 'No frame matches that search. Try a shorter word.',
    count: '{count, plural, one {# frame} other {# frames}}',
    groups: {
      writing: 'Writing and literature',
      history: 'History and area studies',
      law: 'Law, politics, and philosophy',
      policy: 'Policy, health, and social welfare',
      education: 'Education',
      fieldwork: 'Fieldwork and interviews',
      collections: 'Museums, archives, and libraries',
      arts: 'Film, theater, dance, and music',
      business: 'Management',
      science: 'Sciences, engineering, and math',
    },
    f: {
      essayPlanner: {
        name: 'Essay planner',
        use: 'Fill in each part in a few words before you draft, then delete the prompts.',
        keywords: 'essay thesis outline argument revision checklist paper',
        outline: `# Question
> Restate the assignment's question in your own words.
# Thesis
> One sentence that answers the question and that someone could argue with.
# Reasons and evidence
1. First reason, with its evidence and where the evidence comes from
2. Second reason, with its evidence and where the evidence comes from
3. Third reason, with its evidence and where the evidence comes from
# Counterargument and response
# Conclusion
> Say what the argument shows and why it matters.
# Revision checklist
- The thesis answers the question.
- Each paragraph opens with a claim that supports the thesis.
- Every quotation is introduced, cited and explained.
- The counterargument is stated fairly.
- Sources are cited in the required style.`,
      },
      claimEvidence: {
        name: 'Claim, evidence, and reasoning',
        use: 'Write one row for each claim. Reasoning says why the evidence supports the claim.',
        keywords: 'claim evidence reasoning argument paragraph',
        outline: `# Question
| Claim | Evidence | Reasoning |`,
      },
      closeReading: {
        name: 'Close reading of a passage',
        use: 'Read the passage twice before you fill this in, and quote the words you discuss.',
        keywords: 'close reading passage poem prose literature analysis',
        outline: `# Passage and where it comes from
# First impressions
# Language and imagery
> Word choice, figures of speech, sound and repetition.
# Structure and form
# Tone and voice
# Interpretation
> What the passage means, and how its language makes that meaning.
# Questions it leaves open`,
      },
      rhetorical: {
        name: 'Rhetorical analysis',
        use: 'Name the situation first; each appeal only makes sense for a particular audience.',
        keywords: 'rhetoric speech persuasion ethos pathos logos audience',
        outline: `# Rhetorical situation
- Speaker or writer
- Audience
- Purpose
- Context and occasion
# Appeals
- Character and credibility (ethos)
- Emotion (pathos)
- Reasoning and evidence (logos)
# Structure and style
# How well it works, and for whom`,
      },
      literatureReview: {
        name: 'Literature review matrix',
        use: 'Add one row for each source, then read down each column to find patterns and gaps.',
        keywords: 'literature review sources synthesis research matrix',
        outline: `# Research question
# Patterns and gaps
| Source | Question | Method | Findings | Limitations | Relevance |`,
      },
      researchProposal: {
        name: 'Research proposal',
        use: 'Keep each part short; the methods and the ethics checklist are what reviewers read most closely.',
        keywords: 'research proposal methods ethics review prospectus thesis',
        outline: `# Working title
# Research question
# Background and significance
# Methods
# Data and sources
# Timeline
# Ethics review checklist
- How participants give informed consent
- How data is stored and kept private
- Risks to participants and how they are reduced
- Which approval the project needs, and when
# References`,
      },
      translationGrid: {
        name: 'Translation comparison grid',
        use: 'Put one line or sentence in each row, then note what each translation gains or loses.',
        keywords: 'translation compare versions original language literature',
        outline: `# Source text and translations compared
| Line | Original | Translation A | Translation B | Notes |`,
      },
      adaptation: {
        name: 'Adaptation comparison',
        use: 'Compare one element in each row, and say what the change does.',
        keywords: 'adaptation film novel play compare source',
        outline: `# Works compared
# Overall effect of the adaptation
| Element | Source work | Adaptation | Effect of the change |
| Plot |
| Characters |
| Setting |
| Point of view |
| Ending |`,
      },
      visualAnalysis: {
        name: 'Visual and formal analysis',
        use: 'Describe before you interpret: say what is there before what it means.',
        keywords: 'art history painting visual formal analysis object image',
        outline: `# Object
- Artist or maker
- Title and date
- Medium and size
- Where it is now
# Description
# Formal elements
- Line and shape
- Color and light
- Space and composition
- Texture and surface
# Context
# Interpretation`,
      },
      primarySource: {
        name: 'Primary-source analysis',
        use: 'Work through sourcing, context, and corroboration before you decide what the source can prove.',
        keywords: 'primary source document sourcing context corroboration history archive',
        outline: `# Source
- Title or description
- Creator
- Date and place
- Type of source
# Sourcing
> Who made it, when, why, and for whom?
# Context
> What was happening when and where it was made?
# Close reading
# Corroboration
> What do other sources say?
# Reliability and limits
# How I will use it`,
      },
      historiography: {
        name: 'Historiography comparison matrix',
        use: 'Add one row for each historian, and use the last column for how they answer one another.',
        keywords: 'historiography historians interpretation debate matrix',
        outline: `# Question the historians answer
# Where they agree and disagree
| Historian | Thesis | Evidence | Method | Sources | Response |`,
      },
      countryProfile: {
        name: 'Country or region profile',
        use: 'Note a source for each part as you go.',
        keywords: 'country region profile area studies geography politics economy',
        outline: `# Geography
# History
# Government and politics
# Economy
# Society and culture
# Current issues
# Sources`,
      },
      oralHistory: {
        name: 'Oral-history index',
        use: 'Write a time for each change of topic, so a listener can find it in the recording.',
        keywords: 'oral history interview index timestamps recording',
        outline: `# Interview
- Narrator
- Interviewer
- Date and place
- Consent and release
| Time | Topic | Summary | Keywords |`,
      },
      caseBrief: {
        name: 'Case brief',
        use: 'Brief the case in your own words; the holding and the rule are what you will need later.',
        keywords: 'case brief law court IRAC holding issue rule',
        outline: `# Facts
# Procedural history
# Issue
# Rule
# Application
# Holding
# Reasoning
# Notes`,
      },
      argument: {
        name: 'Argument reconstruction',
        use: 'Number the premises so that each step can be checked on its own.',
        keywords: 'argument premises conclusion philosophy logic validity soundness',
        outline: `# Conclusion
# Premises
1. First premise
2. Second premise
3. Third premise
# Unstated assumptions
# Is it valid?
> Would the conclusion have to be true if every premise were true?
# Is it sound?
# Objections and replies`,
      },
      ethicsCase: {
        name: 'Ethics case across four theories',
        use: 'Give each theory its best reading of the case before you object to it.',
        keywords: 'ethics case theory consequentialism deontology virtue care philosophy',
        outline: `# The case
# My own view, and why
| Theory | What it asks | Its verdict | Strongest objection |
| Consequences (utilitarian) |
| Duties and rights (deontology) |
| Virtue and character |
| Care and relationships |`,
      },
      policyMemo: {
        name: 'Policy memo',
        use: 'Lead with the bottom line; a busy reader may read nothing else.',
        keywords: 'policy brief recommendation options decision public policy',
        outline: `# To, from, date and subject
# Bottom line
# Background
# Options
# Analysis
# Recommendation
# Next steps`,
      },
      logicModel: {
        name: 'Logic model and theory of change',
        use: 'Read the table from left to right: each column should lead to the next.',
        keywords: 'logic model theory of change program evaluation outcomes impact',
        outline: `# Problem
# Theory of change
> If we do this, then that will change, because of this reason.
# Assumptions and outside factors
| Inputs | Activities | Outputs | Short-term outcomes | Long-term impact |`,
      },
      optionsMatrix: {
        name: 'Policy options matrix',
        use: 'Score every option against the same criteria, and say how the scores were set.',
        keywords: 'policy options criteria alternatives matrix decision',
        outline: `# Problem
# Criteria and how each is scored
| Option | Effectiveness | Cost | Equity | Feasibility | Overall |`,
      },
      caseFormulation: {
        name: 'De-identified case formulation',
        use: 'For coursework, not clinical use. Use no names, dates, or details that could identify a person.',
        keywords: 'case formulation social work psychology counseling coursework',
        outline: `# Presenting concern
# Background
# Strengths and supports
# Factors
- What made the person vulnerable
- What set the concern off
- What keeps it going
- What protects the person
# Working hypothesis
# Goals and plan`,
      },
      lessonPlan: {
        name: 'Lesson plan',
        use: 'Plan backward: decide what students will understand and how you will know before choosing activities.',
        keywords: 'lesson plan teaching backward design objectives assessment education',
        outline: `# Desired results
- Goals and standards
- Understandings
- Essential questions
# Evidence of learning
# Learning activities in order
1. Opening
2. Main activity
3. Closing
# Materials
# Support and extension for different learners
# Reflection after teaching`,
      },
      smartGoal: {
        name: 'Goal and progress sheet',
        use: 'Write a goal that is specific, measurable, achievable, relevant, and time-bound, then record progress.',
        keywords: 'goal smart progress monitoring education measurable',
        outline: `# Goal
- Specific: what exactly will change
- Measurable: how it will be measured
- Achievable: why it is realistic
- Relevant: why it matters
- Time-bound: by when
| Date | Measure | Progress | Notes |`,
      },
      fieldNotes: {
        name: 'Field notes',
        use: 'Keep what you saw apart from what you think it means.',
        keywords: 'field notes ethnography observation anthropology sociology',
        outline: `# Setting
- Date and time
- Place
- Who is present
# Observations
# Conversations
# Reflections
# Questions for next time`,
      },
      interviewGuide: {
        name: 'Interview guide and log',
        use: 'Ask the main questions in order and use the probes only as needed.',
        keywords: 'interview guide questions log qualitative research consent',
        outline: `# Purpose
# Consent and recording
# Opening questions
# Main questions
1. First question
2. Second question
3. Third question
# Probes
# Closing
| Date | Participant code | Length | Notes |`,
      },
      objectRecord: {
        name: 'Object record',
        use: 'Fill in the fields you know; the field names are the fifteen Dublin Core elements.',
        keywords: 'object record metadata dublin core catalog archive library museum',
        outline: `| Field | Value |
| Title |
| Creator |
| Subject |
| Description |
| Publisher |
| Contributor |
| Date |
| Type |
| Format |
| Identifier |
| Source |
| Language |
| Relation |
| Coverage |
| Rights |`,
      },
      conditionReport: {
        name: 'Condition report',
        use: 'Describe what you see and where; a photograph of each area helps.',
        keywords: 'condition report conservation object damage museum',
        outline: `# Object
- Identifier and title
- Materials
- Size
# Overall condition
# Recommendations
| Area | Condition | Notes |`,
      },
      exhibitionLabel: {
        name: 'Exhibition label',
        use: 'Keep the label text to about 75 words, written for a visitor standing in front of the object.',
        keywords: 'exhibition label wall text museum gallery',
        outline: `# Title
# Artist or maker, with dates
# Date, medium and size
# Credit line
# Label text`,
      },
      shotList: {
        name: 'Shot list',
        use: 'Add one row for each shot, in the order you plan to shoot.',
        keywords: 'shot list film video camera production',
        outline: `# Scene
| Shot | Size | Angle | Movement | Description | Duration |`,
      },
      callSheet: {
        name: 'Call sheet',
        use: 'Share the sheet the day before the shoot.',
        keywords: 'call sheet film production schedule crew cast',
        outline: `# Production and date
# Location and parking
# Weather and daylight
# Schedule
| Name | Role | Call time | Notes |`,
      },
      scriptBreakdown: {
        name: 'Script breakdown sheet',
        use: 'Make one sheet for each scene, and list everything the scene needs.',
        keywords: 'script breakdown film theater production scene props',
        outline: `# Scene number and page count
# Interior or exterior, day or night
| Category | Items |
| Cast |
| Extras |
| Props |
| Costumes |
| Makeup and hair |
| Set dressing |
| Vehicles |
| Sound |
| Special effects |`,
      },
      rehearsalReport: {
        name: 'Rehearsal report',
        use: 'Send the report the same day, with a note for each department.',
        keywords: 'rehearsal report stage management theater',
        outline: `# Date, time and place
# Attendance
# Work done
# Notes for departments
- Scenery
- Costumes
- Lighting
- Sound
- Props
# Next rehearsal`,
      },
      eightCount: {
        name: 'Eight-count choreography grid',
        use: 'Write the movement on each count, and use the notes for formations and facings.',
        keywords: 'dance choreography counts eight count',
        outline: `# Music and tempo
| Section | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | Notes |`,
      },
      practiceLog: {
        name: 'Practice log',
        use: 'Note a tempo or level each time, so progress shows over the week.',
        keywords: 'practice log music instrument rehearsal',
        outline: `# Goals for this week
| Date | Minutes | What I practiced | Tempo or level | Notes |`,
      },
      listeningLog: {
        name: 'Listening log',
        use: 'Write what you heard before you read about the piece.',
        keywords: 'listening log music journal concert',
        outline: `# What to listen for
| Work | Composer or performer | When and where | What I heard | Questions |`,
      },
      businessModel: {
        name: 'Business model canvas',
        use: 'Start with customer segments and value propositions, then fill in the rest.',
        keywords: 'business model canvas management strategy startup',
        outline: `# Customer segments
# Value propositions
# Channels
# Customer relationships
# Revenue streams
# Key resources
# Key activities
# Key partners
# Cost structure`,
      },
      swot: {
        name: 'Strengths, weaknesses, opportunities, and threats',
        use: 'Strengths and weaknesses are inside the organization; opportunities and threats are outside it.',
        keywords: 'swot strategy analysis management',
        outline: `# Strengths
# Weaknesses
# Opportunities
# Threats
# What to do about it`,
      },
      valueChain: {
        name: 'Value chain',
        use: 'Note where each activity adds value or cost.',
        keywords: 'value chain strategy operations management',
        outline: `# Primary activities
- Inbound logistics
- Operations
- Outbound logistics
- Marketing and sales
- Service
# Support activities
- Firm infrastructure
- Human resources
- Technology
- Procurement
# Where the most value is added`,
      },
      fiveForces: {
        name: 'Five forces analysis',
        use: 'Rate each force as weak, moderate or strong, and give the reason.',
        keywords: 'five forces industry competition strategy management',
        outline: `# Rivalry among competitors
# Threat of new entrants
# Threat of substitutes
# Bargaining power of buyers
# Bargaining power of suppliers
# Overall attractiveness of the industry`,
      },
      labReport: {
        name: 'Lab report',
        use: 'Write the methods so that someone else could repeat the work.',
        keywords: 'lab report IMRaD experiment science introduction methods results discussion',
        outline: `# Title
# Abstract
# Introduction
# Methods
# Results
# Discussion
# References`,
      },
      designReview: {
        name: 'Design review and requirements',
        use: 'Give each requirement a way to verify it.',
        keywords: 'design review requirements engineering verification',
        outline: `# Problem statement
# Constraints
# Decisions and reasons
# Risks
| Requirement | Priority | How it is verified | Status |`,
      },
      problemJournal: {
        name: 'Problem-solving journal',
        use: 'Write in each part, even when the answer seems obvious.',
        keywords: 'problem solving journal math understand plan solve check',
        outline: `# Understand
> What is given, and what is asked?
# Plan
# Solve
# Check
> Does the answer make sense? Is there another way?`,
      },
      proofOutline: {
        name: 'Proof outline',
        use: 'Name the technique before you write the steps.',
        keywords: 'proof outline math claim induction contradiction',
        outline: `# Claim
# Technique
> Direct, contrapositive, contradiction, induction or cases.
# Steps
1. First step
2. Second step
3. Third step
# Conclusion`,
      },
    },
  },
  coordinates: {
    title: 'Coordinates and navigation',
    open: 'Open coordinates and navigation',
    keywords:
      'coordinates latitude longitude UTM MGRS state plane geodesic distance azimuth bearing navigation compass',
    modes: 'Coordinate tools',
    tabs: {
      convert: 'Convert',
      distance: 'Distance',
      zone: 'Grid zone',
      site: 'Site grid',
      land: 'Land navigation',
      marine: 'Marine navigation',
    },
    input: 'Enter as',
    inputs: { degrees: 'Latitude and longitude', utm: 'UTM', mgrs: 'MGRS or USNG' },
    lat: 'Latitude',
    lon: 'Longitude',
    angleHint: 'Decimal degrees, or degrees, minutes and seconds with N, S, E, or W.',
    zone: 'Zone',
    hemisphere: 'Hemisphere',
    north: 'North',
    south: 'South',
    easting: 'Easting (m)',
    northing: 'Northing (m)',
    mgrs: 'Grid reference',
    mgrsHint: 'For example 18T WK 00000 27757.',
    rows: {
      decimal: 'Decimal degrees',
      dms: 'Degrees, minutes, and seconds',
      dm: 'Degrees and decimal minutes',
      utm: 'UTM',
      mgrs: 'MGRS',
      convergence: 'Grid convergence',
      scale: 'Scale factor',
      distance: 'Geodesic distance',
      azimuth1: 'Initial azimuth',
      azimuth2: 'Final azimuth',
      haversine: 'Great-circle distance on a sphere',
      rhumbCourse: 'Rhumb-line course',
      rhumbDistance: 'Rhumb-line distance',
      midpoint: 'Midpoint',
      destination: 'Destination',
      arrival: 'Azimuth on arrival',
      latLon: 'Latitude and longitude',
      grid: 'Easting and northing',
    },
    utmValue: 'zone {zone}{band}, easting {easting}, northing {northing}',
    pointValue: '{lat}, {lon}',
    distanceValue: '{km} km, {mi} mi, {nmi} nmi',
    degreesValue: '{value}°',
    fromLat: 'Start latitude',
    fromLon: 'Start longitude',
    toLat: 'End latitude',
    toLon: 'End longitude',
    problem: 'Problem',
    problems: { inverse: 'Distance between two points', direct: 'Point at a distance and azimuth' },
    azimuth: 'Azimuth (degrees from north)',
    distanceKm: 'Distance (km)',
    zoneKind: 'Projection',
    kinds: { lambert: 'Lambert conformal conic', tm: 'Transverse Mercator' },
    ellipsoid: 'Ellipsoid',
    ellipsoids: { grs80: 'The GRS 80 ellipsoid, used with NAD 83', wgs84: 'The WGS 84 ellipsoid' },
    units: 'Grid units',
    unitNames: { m: 'Meters', usft: 'US survey feet', ft: 'International feet' },
    direction: 'Convert',
    directions: { toGrid: 'Latitude and longitude to grid', toGeo: 'Grid to latitude and longitude' },
    lat1: 'First standard parallel',
    lat2: 'Second standard parallel',
    lat0: 'Latitude of origin',
    lon0: 'Central meridian',
    k0: 'Scale on the central meridian',
    falseEasting: 'False easting (grid units)',
    falseNorthing: 'False northing (grid units)',
    gridE: 'Easting (grid units)',
    gridN: 'Northing (grid units)',
    zoneNote:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'Type the zone parameters from its published sheet. State Plane zones are published by the National Geodetic Survey.',
    controls: 'Control points',
    controlsHint: 'One point a line: site x, site y, map easting, map northing.',
    siteX: 'Site x',
    siteY: 'Site y',
    siteRows: {
      scale: 'Scale',
      rotation: 'Rotation',
      shift: 'Shift',
      rms: 'Root-mean-square residual',
      mapped: 'Map position of the site point',
    },
    shiftValue: 'easting {e}, northing {n}',
    residualCaption: 'Residuals at the control points',
    residualHeader: { point: 'Point', de: 'Easting residual', dn: 'Northing residual' },
    landModes: { azimuth: 'Azimuths', pace: 'Pace count', intersect: 'Intersection', resect: 'Resection' },
    landMode: 'Problem',
    azimuthValue: 'Azimuth',
    azimuthKind: 'Measured as',
    azimuthKinds: { true: 'True', magnetic: 'Magnetic', grid: 'Grid' },
    declination: 'Declination (degrees, east positive)',
    convergence: 'Grid convergence (degrees, east positive)',
    navRows: {
      true: 'True azimuth',
      magnetic: 'Magnetic azimuth',
      grid: 'Grid azimuth',
      back: 'Back azimuth (true)',
      gm: 'Grid-magnetic angle',
      distance: 'Distance walked',
      point: 'Position',
      along1: 'Distance from the first point',
      along2: 'Distance from the second point',
    },
    paces: 'Paces counted',
    pacesPer100: 'Paces for 100 m',
    p1x: 'First point x (east)',
    p1y: 'First point y (north)',
    p2x: 'Second point x (east)',
    p2y: 'Second point y (north)',
    az1: 'Azimuth from the first point',
    az2: 'Azimuth from the second point',
    l1x: 'First landmark x (east)',
    l1y: 'First landmark y (north)',
    l2x: 'Second landmark x (east)',
    l2y: 'Second landmark y (north)',
    taz1: 'Azimuth you measured to the first landmark',
    taz2: 'Azimuth you measured to the second landmark',
    behind: 'The lines cross behind one of the points, so check the azimuths.',
    xyValue: '({x}, {y})',
    marineModes: {
      reckon: 'Dead reckoning',
      current: 'Current triangle',
      tsd: 'Time, speed, and distance',
      chart: 'Chart scale',
    },
    course: 'Course (degrees true)',
    knots: 'Speed (knots)',
    hours: 'Time (hours)',
    method: 'Latitude used',
    methods: { mid: 'Mean latitude of the run (mid-latitude sailing)', start: 'Latitude of the fix' },
    track: 'Track wanted (degrees true)',
    set: 'Current set (degrees true)',
    drift: 'Current drift (knots)',
    miles: 'Distance (nautical miles)',
    tsdHint: 'Leave the one you want empty.',
    chartCm: 'Distance on the chart (cm)',
    denominator: 'Scale 1 to',
    marineRows: {
      run: 'Distance run',
      dlat: 'Change of latitude',
      dlon: 'Change of longitude',
      departure: 'Departure',
      position: 'Dead-reckoning position',
      heading: 'Course to steer',
      correction: 'Correction for the current',
      made: 'Speed made good',
      time: 'Time',
      speed: 'Speed',
      distance: 'Distance',
      ground: 'Ground distance',
    },
    milesValue: '{value} nmi',
    knotsValue: '{value} kn',
    hoursValue: '{value} h',
    metersValue: '{value} m',
    kmValue: '{value} km',
    diagram: 'Diagram of the bearing lines',
    currentDiagram: 'Current triangle diagram',
    steps: {
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      zone: 'Zone {zone}, central meridian {meridian}°: floor((lon + 180) / 6) + 1, with the Norway and Svalbard exceptions.',
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      tm: 'Transverse Mercator by the Krüger series to sixth order: E = 500 000 + k0 A eta and N = k0 A xi, k0 = 0.9996.',
      south: 'South of the equator a false northing of 10 000 000 m is added.',
      utm: 'Result: {utm}.',
      mgrs: 'MGRS: column and row letters for the 100 km square, then the easting and northing within it: {mgrs}.',
      vincenty: "Vincenty's inverse formula on {ellipsoid} converged in {count} iterations.",
      distance: 'Distance {distance} m, initial azimuth {az1}°, final azimuth {az2}°.',
      haversine: 'For comparison, a sphere of radius 6371.0088 km gives {distance} m.',
      direct: "Vincenty's direct formula from ({lat}, {lon}) on azimuth {az}° for {distance} m.",
      lambert:
        // checks-disable-next-line length: one message or table, kept whole so the key types read it
        'Lambert conformal conic: n, F, and rho0 from the standard parallels, then rho = a·F·t^n, theta = n·(lon − lon0).',
      tmZone: 'Transverse Mercator with k0 = {k0}, northing measured from latitude {lat0}°.',
      units: 'Grid values converted with 1 {unit} = {meters} m.',
      helmert: 'Least-squares fit of E = a·x − b·y + c and N = b·x + a·y + d to {count} control points.',
      helmertResult: 'a = {a}, b = {b}: scale {scale}, rotation {rotation}°.',
      declination: 'Magnetic = true - declination = {true}° - ({decl}°) = {magnetic}°.',
      grid: 'Grid = true - convergence = {true}° - ({conv}°) = {grid}°.',
      back: 'Back azimuth = azimuth ± 180° = {back}°.',
      pace: 'Distance = paces × 100 / paces for 100 m = {paces} × 100 / {per} = {distance} m.',
      intersect: 'Each line runs from its point in the direction (sin az, cos az); the two lines meet at ({x}, {y}).',
      resect: 'Resection draws the back azimuths, {b1}° and {b2}°, from the landmarks; they cross at your position.',
      reckon: 'Distance = speed × time = {knots} × {hours} = {distance} nmi.',
      dlat: 'Change of latitude = distance × cos(course) / 60 = {dlat}°.',
      dlon: 'Change of longitude = distance × sin(course) / (60 cos({lat}°)) = {dlon}°.',
      steer: 'sin(correction) = drift × sin(set - track) / speed; steer {heading}° and make good {made} kn.',
      tsd: 'Distance = speed × time.',
      chart: 'Ground distance = chart distance × {denominator} = {meters} m.',
    },
    errors: {
      latitude: 'The latitude has to be between 90° S and 90° N.',
      longitude: 'The longitude has to be between 180° W and 180° E.',
      number: 'Type a number in every field.',
      empty: 'Type an angle.',
      hemisphere: 'Use N or S for a latitude and E or W for a longitude, and not with a minus sign.',
      angleFormat: 'Type the angle as decimal degrees, or as degrees, minutes, and seconds.',
      minutesRange: 'Minutes and seconds have to be less than 60.',
      antipodal: 'The points are nearly opposite each other on the Earth, where this method does not converge.',
      pole: 'This works only away from the poles.',
      farFromMeridian: 'The point is too far from the central meridian for this projection.',
      polar: 'UTM covers 80° S to 84° N. Nearer the poles, maps use the polar stereographic grid instead.',
      zone: 'The zone has to be a whole number from 1 to 60.',
      utmRange: 'The easting or northing is outside the UTM grid.',
      digits: 'Use 0 to 5 digits for each of the easting and the northing.',
      mgrsFormat: 'Type a grid reference as zone, band, two square letters, and an even number of digits.',
      mgrsSquare: 'Those square letters are not used in this zone.',
      parallels: 'The standard parallels cannot be at equal distances on opposite sides of the equator.',
      fewPoints: 'Add at least two control points.',
      samePoints: 'The control points are all in one place. Use points spread across the site.',
      positive: 'Use numbers of 0 or more, and more than 0 where you divide by them.',
      parallel: 'The two lines are parallel, so they never cross.',
      currentTooStrong: 'The current is too strong for the boat to hold that track.',
      twoOfThree: 'Fill in exactly two of time, speed, and distance.',
      unknown: 'That could not be worked out. Check the numbers.',
    },
  },
  keys: {
    title: 'Identification keys',
    open: 'Open identification keys',
    keywords:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'identification key dichotomous couplet multi-access character matrix taxon specimen mineral artifact instrument catalog',
    modes: 'Key tools',
    tabs: { table: 'Character table', key: 'Dichotomous key', multi: 'Multi-access key', catalog: 'Catalog' },
    template: 'Start from',
    templates: {
      letters: 'Four taxa, two characters',
      instruments: 'Musical instruments, top levels',
      minerals: 'Minerals by hardness',
      artifacts: 'Blank artifact types',
      taxa: 'Blank taxa',
    },
    use: 'Use this table',
    table: 'Character table',
    tableHint:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'One line for each taxon or type: its name, then a state for each character, split by commas or tabs. Use ? for unknown and a/b for either state. Numbers and ranges such as 3-5 make a numeric character.',
    summary:
      '{taxa, plural, one {# taxon} other {# taxa}} and {characters, plural, one {# character} other {# characters}}.',
    keySummary:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'The key has {couplets, plural, one {# couplet} other {# couplets}} and is {depth, plural, one {# couplet} other {# couplets}} deep.',
    inseparable: 'The characters cannot tell these apart: {names}. Add a character that differs between them.',
    allSeparated: 'Every taxon is reached on its own.',
    or: 'or',
    leadStates: '{character}: {states}',
    leadAtMost: '{character}: {value} or less',
    leadAbove: '{character}: more than {value}',
    keyText: 'Key text',
    picture: 'Key drawn as a tree',
    pictureAlt: 'A dichotomous key drawn as a tree, with {couplets, plural, one {# couplet} other {# couplets}}.',
    why: 'Couplet {number} uses {character}: it splits {before} taxa into {first} and {second} and gives {gain} bits.',
    whyHint: 'A taxon with an unknown state goes down both leads.',
    run: 'Run the key',
    couplet: 'Couplet {number}',
    trail: 'Path so far',
    back: 'Back',
    restart: 'Start again',
    reached: 'Identified as {name}.',
    unresolved: 'The key ends with more than one candidate: {names}.',
    addToCatalog: 'Add to catalog',
    character: 'Character',
    any: 'Not answered',
    measured: 'Measured value',
    candidates: 'Candidates ({count})',
    contradictory: 'No taxon fits all of these answers. Check them, or clear one.',
    clear: 'Clear answers',
    catalog: 'Catalog rows',
    catalogHint: 'One row for each specimen or object: id, locality, date, collector, determination.',
    catalogHeader: {
      id: 'Id',
      locality: 'Locality',
      date: 'Date',
      collector: 'Collector',
      determination: 'Determination',
    },
    insertCatalog: 'Insert catalog table',
    insertKey: 'Insert key text',
    source:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'Instrument classes after Hornbostel and Sachs, 1914 (public domain). The Mohs scale minerals and hardness values are common facts.',
    tables: {
      letters: 'Taxon, Character 1, Character 2\nA, 1, 1\nB, 1, 0\nC, 0, 1\nD, 0, 0',
      instruments:
        // checks-disable-next-line length: one message or table, kept whole so the key types read it
        'Class, Vibrating part, Set sounding by, Resonator removable, Air enclosed\n11 Struck idiophones, body, struck, ?, ?\n12 Plucked idiophones, body, plucked, ?, ?\n13 Friction idiophones, body, rubbed, ?, ?\n14 Blown idiophones, body, blown, ?, ?\n21 Struck drums, membrane, struck, ?, ?\n22 Plucked drums, membrane, plucked, ?, ?\n23 Friction drums, membrane, rubbed, ?, ?\n24 Singing membranes, membrane, voice, ?, ?\n31 Simple chordophones, string, ?, yes, ?\n32 Composite chordophones, string, ?, no, ?\n41 Free aerophones, air, ?, ?, no\n42 Wind instruments proper, air, ?, ?, yes',
      minerals:
        // checks-disable-next-line length: one message or table, kept whole so the key types read it
        'Mineral, Hardness, Luster\nTalc, 1, nonmetallic\nGypsum, 2, nonmetallic\nCalcite, 3, nonmetallic\nFluorite, 4, nonmetallic\nApatite, 5, nonmetallic\nOrthoclase, 6, nonmetallic\nQuartz, 7, nonmetallic\nTopaz, 8, nonmetallic\nCorundum, 9, nonmetallic\nDiamond, 10, nonmetallic',
      artifacts: 'Type, Material, Shape, Decoration\nType A, ?, ?, ?\nType B, ?, ?, ?',
      taxa: 'Taxon, Character 1, Character 2, Character 3\nTaxon A, ?, ?, ?\nTaxon B, ?, ?, ?',
    },
    errors: {
      empty: 'Add a header line and at least one line for a taxon.',
      noCharacters: 'Add at least one character after the name column.',
      tooMany: 'That table is too large. Use at most 500 taxa and 100 characters.',
      unnamed: 'Give every line a name in the first column.',
      duplicate: 'Two lines have the same name. Give each taxon its own name.',
      width: 'A line has more cells than the header has columns.',
      pastEnd: 'The key has already ended.',
      number: 'Type a number.',
      unknown: 'That table could not be read. Check its lines.',
    },
  },
} as const;
