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
    insertFigure: 'Insert editable figure',
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
  timeline: {
    title: 'Timeline builder',
    open: 'Open the timeline builder',
    keywords: 'timeline chronology events periods dynasty reign era BCE CE deep time geologic years before present',
    rows: 'Events and periods',
    rowsHint:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'One line each: label, start, end, track, kind, notes. Leave the end empty for an event, and write era as the kind for a band behind every track. Dates can be 1603, 1603-03-24, 44 BCE, c. 1200 BCE, 1450 ± 10, the 1960s, 5th century BCE, 66 Ma, or 11700 BP.',
    fromPage: 'Use a table on the page',
    noTable: 'No table was found on the open page. Click in a page with a table first.',
    tookTable: 'Read table {number} from the page.',
    scale: 'Axis',
    scales: { linear: 'Linear', log: 'Years before present, logarithmic', broken: 'Linear with a break' },
    viewFrom: 'View from (year)',
    viewTo: 'View to (year)',
    viewHint: 'Leave empty to fit every date. Use + and - to zoom and the arrow keys to pan the picture.',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    earlier: 'Earlier',
    later: 'Later',
    fit: 'Fit all',
    pictureLabel: 'Timeline picture. Press + or - to zoom and the left or right arrow to pan.',
    // checks-disable-next-line length: one message or table, kept whole so the key types read it
    alt: 'Timeline of {items, plural, one {# item} other {# items}} on {tracks, plural, one {# track} other {# tracks}}, from {from} to {to}.',
    summary: '{items, plural, one {# item} other {# items}} on {tracks, plural, one {# track} other {# tracks}}.',
    first: 'First',
    second: 'Second',
    query: 'Compare two rows',
    durationOf: 'Length of {label}',
    between: 'From {first} to {second}',
    overlapRow: 'Overlap',
    overlapValue: '{start} to {end} ({length, plural, one {# year} other {# years}})',
    noOverlap: 'They do not overlap.',
    years: '{value, plural, one {# year} other {# years}}',
    yearsApprox: 'about {value} years',
    yearBce: '{year} BCE',
    yearCe: '{year} CE',
    yearPlain: '{year}',
    ga: '{value} Ga',
    ma: '{value} Ma',
    ka: '{value} ka',
    bp: '{value} BP',
    before: '← {label}',
    after: '{label} →',
    tableHeader: { label: 'Label', start: 'Start', end: 'End', track: 'Track', length: 'Length' },
    noTrack: 'Main',
    example:
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      'Label, Start, End, Track, Kind\nMing dynasty, 1368, 1644, China\nQing dynasty, 1644, 1912, China\nEdo period, 1603, 1868, Japan\nTokugawa Ieyasu, 1543, 1616, Japan\nBattle of Sekigahara, 1600-10-21, , Japan\nEarly modern, 1500, 1800, , era',
    steps: {
      // checks-disable-next-line length: one message or table, kept whole so the key types read it
      era: 'Years are kept as astronomical years inside: 1 BCE is year 0 and 2 BCE is year -1, so a length is the later year less the earlier one.',
      bp: 'Years before present count back from 1950, the radiocarbon convention.',
      read: '{text} was read as astronomical year {value}.',
      readSpread: '{text} was read as astronomical year {value} ± {spread}.',
      readRange: '{text} was read as astronomical years {low} to {high}.',
      length: '{label}: {end} − ({start}) = {length} years.',
      overlap: 'Overlap: the later start, {start}, to the earlier end, {end}, is {length} years.',
      lanes: 'Items on a track that would overlap, label included, move to the next free row.',
    },
    errors: {
      empty: 'Type a date.',
      date: 'That date could not be read. Try 1603, 44 BCE, c. 1200 BCE, the 1960s, or 66 Ma.',
      yearZero: 'There is no year 0 BCE or 0 CE. Use 1 BCE, or 0 for the astronomical year.',
      month: 'Use a month from 1 to 12.',
      day: 'That month does not have that day.',
      huge: 'Use dates within ten billion years.',
      label: 'Give the row a label in the first column.',
      order: 'The end comes before the start.',
      eraEnd: 'An era needs an end date.',
      noRows: 'Add at least one event or period.',
      tooMany: 'Use at most 2,000 rows.',
      range: 'The view has to end after it starts.',
      logRange: 'A logarithmic axis needs dates before the present.',
      gap: 'The break has to fall between the first and last dates.',
      line: 'Line {line}: {problem}',
      unknown: 'That could not be drawn. Check the rows.',
    },
  },
  calendars: {
    title: 'Calendars and eras',
    open: 'Open the calendar and era converter',
    keywords:
      'calendar convert Julian Gregorian Hebrew Islamic Hijri Persian Chinese lunar new year Easter Maya Coptic Ethiopian era weekday',
    modes: 'Calendar tools',
    tabs: { convert: 'Convert a date', festivals: 'Festivals in a year', eras: 'Era table' },
    system: 'Calendar',
    systems: {
      gregorian: 'Gregorian',
      julian: 'Julian',
      hebrew: 'Hebrew',
      islamic: 'Islamic (tabular, civil)',
      islamicAstro: 'Islamic (tabular, astronomical epoch)',
      persian: 'Solar Hijri (Persian)',
      chinese: 'Chinese',
      coptic: 'Coptic',
      ethiopian: 'Ethiopian',
      republican: 'French Republican',
      saka: 'Indian national (Saka)',
      maya: 'Maya Long Count',
      jdn: 'Julian Day Number',
    },
    year: 'Year',
    month: 'Month (number)',
    day: 'Day',
    leapMonth: 'Leap month',
    longCount: 'Long Count',
    longCountHint: 'Five numbers with dots, such as 13.0.0.0.0.',
    jdnField: 'Day number',
    yearHint: 'Gregorian and Julian years are astronomical: 0 is 1 BCE, and -43 is 44 BCE.',
    results: 'The date in every calendar',
    rows: {
      jdn: 'Julian Day Number',
      weekday: 'Weekday',
      gregorian: 'Gregorian',
      julian: 'Julian',
      iso: 'ISO week',
      dayOfYear: 'Day of the year',
      hebrew: 'Hebrew',
      islamic: 'Islamic, civil',
      islamicAstro: 'Islamic, astronomical',
      persian: 'Solar Hijri',
      chinese: 'Chinese',
      japanese: 'Japanese era',
      coptic: 'Coptic',
      ethiopian: 'Ethiopian',
      republican: 'French Republican',
      saka: 'Indian national',
      maya: 'Maya',
      roman: 'Roman (Julian date)',
      olympiad: 'Olympiad',
      egyptian: 'Egyptian civil',
      armenian: 'Armenian civil',
      era: 'Era table',
    },
    value: {
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      date: '{day} {month} {year}',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      bce: '{day} {month} {year} BCE',
      iso: 'Week {week} of {year}, day {day}',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      hebrew: '{day} {month} {year} AM',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      islamic: '{day} {month} {year} AH',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      persian: '{day} {month} {year} SH',
      chinese: 'Month {month}, day {day}, year of the {animal} ({stem}{branch}); day {dayStem}{dayBranch}',
      chineseLeap: 'Leap month {month}, day {day}, year of the {animal} ({stem}{branch}); day {dayStem}{dayBranch}',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      japanese: '{era} {year} (imperial year {imperial})',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      maya: '{longCount}, {tzolkinNumber} {tzolkin} {haabDay} {haab}',
      roman: '{roman}, {auc} AUC',
      olympiad: 'Olympiad {olympiad}, year {year}',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      era: '{name} {year}',
      outside: 'Outside this calendar’s range',
    },
    roman: {
      kalends: 'Kal. {month}',
      nones: 'Non. {month}',
      ides: 'Id. {month}',
      pridie: 'prid. {anchor}',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      before: 'a.d. {count} {anchor}',
      bis: 'a.d. bis VI Kal. Mart.',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      months: 'Ian.|Feb.|Mart.|Apr.|Mai.|Iun.|Iul.|Aug.|Sept.|Oct.|Nov.|Dec.',
    },
    // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
    weekdays: 'Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday',
    stems: 'jia|yi|bing|ding|wu|ji|geng|xin|ren|gui',
    branches: 'zi|chou|yin|mao|chen|si|wu|wei|shen|you|xu|hai',
    // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
    animals: 'Rat|Ox|Tiger|Rabbit|Dragon|Snake|Horse|Goat|Monkey|Rooster|Dog|Pig',
    // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
    tzolkin: 'Imix|Ik|Akbal|Kan|Chicchan|Cimi|Manik|Lamat|Muluc|Oc|Chuen|Eb|Ben|Ix|Men|Cib|Caban|Etznab|Cauac|Ahau',
    // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
    haab: 'Pop|Uo|Zip|Zotz|Tzec|Xul|Yaxkin|Mol|Chen|Yax|Zac|Ceh|Mac|Kankin|Muan|Pax|Kayab|Cumku|Uayeb',
    japaneseEras: { meiji: 'Meiji', taisho: 'Taishō', showa: 'Shōwa', heisei: 'Heisei', reiwa: 'Reiwa' },
    months: {
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      gregorian: 'January|February|March|April|May|June|July|August|September|October|November|December',
      hebrew: {
        tishrei: 'Tishrei',
        heshvan: 'Heshvan',
        kislev: 'Kislev',
        tevet: 'Tevet',
        shevat: 'Shevat',
        adar: 'Adar',
        adar1: 'Adar I',
        adar2: 'Adar II',
        nisan: 'Nisan',
        iyar: 'Iyar',
        sivan: 'Sivan',
        tammuz: 'Tammuz',
        av: 'Av',
        elul: 'Elul',
      },
      islamic:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Muharram|Safar|Rabi al-Awwal|Rabi al-Thani|Jumada al-Ula|Jumada al-Akhirah|Rajab|Shaban|Ramadan|Shawwal|Dhu al-Qadah|Dhu al-Hijjah',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      persian: 'Farvardin|Ordibehesht|Khordad|Tir|Mordad|Shahrivar|Mehr|Aban|Azar|Dey|Bahman|Esfand',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      coptic: 'Thout|Paopi|Hathor|Koiak|Tobi|Meshir|Paremhat|Parmouti|Pashons|Paoni|Epip|Mesori|Pi Kogi Enavot',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      ethiopian: 'Meskerem|Tikimt|Hidar|Tahsas|Tir|Yekatit|Megabit|Miyazya|Ginbot|Sene|Hamle|Nehase|Pagume',
      republican:
        'Vendémiaire|Brumaire|Frimaire|Nivôse|Pluviôse|Ventôse|Germinal|Floréal|Prairial|Messidor|Thermidor|Fructidor|Sansculottides',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      saka: 'Chaitra|Vaishakha|Jyeshtha|Ashadha|Shravana|Bhadra|Ashvin|Kartika|Agrahayana|Pausha|Magha|Phalguna',
      egyptian: 'Thoth|Phaophi|Athyr|Choiak|Tybi|Mechir|Phamenoth|Pharmuthi|Pachon|Payni|Epiphi|Mesore|Epagomenal days',
      // checks-disable-next-line ui-voice: names, lists, and placeholder messages, kept whole so the key types read them
      armenian: 'Navasard|Hori|Sahmi|Tre|Kaloch|Arats|Mehekan|Areg|Ahekan|Mareri|Margats|Hrotits|Aveleats',
    },
    festivalYear: 'Gregorian year',
    festivals: 'Festivals and holy days in {year}',
    festivalHeader: { name: 'Day', date: 'Gregorian date', calendar: 'Calendar' },
    festivalCalendar: {
      christian: 'Christian',
      hebrew: 'Hebrew',
      islamic: 'Islamic (tabular)',
      chinese: 'Chinese',
      persian: 'Solar Hijri',
    },
    feast: {
      westernEaster: 'Easter (Western)',
      orthodoxEaster: 'Easter (Orthodox)',
      ashWednesday: 'Ash Wednesday',
      palmSunday: 'Palm Sunday',
      goodFriday: 'Good Friday',
      ascension: 'Ascension',
      pentecost: 'Pentecost',
      roshHashanah: 'Rosh Hashanah',
      yomKippur: 'Yom Kippur',
      sukkot: 'Sukkot',
      sheminiAtzeret: 'Shemini Atzeret',
      hanukkah: 'Hanukkah (first day)',
      purim: 'Purim',
      passover: 'Passover (first day)',
      shavuot: 'Shavuot',
      tishaBav: 'Tisha B’Av',
      islamicNewYear: 'Islamic New Year',
      ashura: 'Ashura',
      mawlid: 'Mawlid',
      israMiraj: 'Isra and Miraj',
      ramadan: 'First day of Ramadan',
      eidFitr: 'Eid al-Fitr',
      eidAdha: 'Eid al-Adha',
      springFestival: 'Spring Festival',
      lantern: 'Lantern Festival',
      qingming: 'Qingming',
      dragonBoat: 'Dragon Boat Festival',
      qixi: 'Qixi',
      midAutumn: 'Mid-Autumn Festival',
      doubleNinth: 'Double Ninth Festival',
      nowruz: 'Nowruz',
    },
    islamicNote:
      // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
      'Islamic dates here are tabular. Where the month begins with sighting of the moon, or by the Umm al-Qura calendar, the day can differ by one or two.',
    erasLabel: 'Eras',
    erasHint:
      'One era a line: its first day as a Gregorian date (YYYY-MM-DD), then its name. The year it starts is year 1.',
    erasExample: '# Replace these lines with your own eras.\n1900-01-01, First era\n1925-06-15, Second era',
    erasNote:
      // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
      'The Japanese eras from Meiji on are built in. Type earlier Japanese, Chinese, or Korean reign eras here; the table is yours to fill.',
    source:
      // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
      'Hebrew, Islamic, Coptic, Ethiopian, Saka, Maya, and Roman dates are arithmetic. Equinoxes, solar terms, and new moons use the published series in Meeus, Astronomical Algorithms.',
    steps: {
      jdn: 'Julian Day Number {jdn}: the days since noon on 1 January 4713 BCE (Julian). Every calendar converts through it.',
      gregorian:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Gregorian: a = ⌊(14 − month)/12⌋, y = year + 4800 − a, m = month + 12a − 3, then JDN = day + ⌊(153m + 2)/5⌋ + 365y + ⌊y/4⌋ − ⌊y/100⌋ + ⌊y/400⌋ − 32045.',
      weekday: 'Weekday: (JDN + 1) mod 7 = {value}, where 0 is Sunday.',
      hebrew:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Hebrew {year}: {months} months since the epoch. The molad of Tishrei is on {weekday}, {hours} h {parts} parts after 6 p.m. the evening before.',
      hebrewRules: 'Postponements: {rules}. 1 Tishrei is JDN {jdn}, and the year has {length} days ({kind}).',
      hebrewNone: 'No postponement applies. 1 Tishrei is JDN {jdn}, and the year has {length} days ({kind}).',
      islamic:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Islamic: JDN = day + ⌈29.5(month − 1)⌉ + 354(year − 1) + ⌊(3 + 11·year)/30⌋ + epoch − 1, with epoch 1948440 (civil) or 1948439 (astronomical).',
      persian:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Solar Hijri {year}: the March equinox of {gregorian} is at {time} Tehran time, {side} noon, so the year begins on {start}. The 33-year rule says the year {rule}; the sky says it {sky}.',
      chinese:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Chinese: the eleventh month holds the winter solstice. From that month to the next eleventh there are {count} new moons, so the year {leap}. New moons and solar terms are reckoned at UTC+8.',
      // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
      maya: 'Maya: days since the creation date (JDN 584283, the GMT correlation) = {days}. Divide by 144000, 7200, 360, and 20 for the Long Count.',
      roman:
        // checks-disable-next-line length: names, lists, and placeholder messages, kept whole so the key types read them
        'Roman: count back, counting both ends, to the next Kalends (the 1st), Nones (the 5th, or the 7th in March, May, July, and October), or Ides (the 13th, or the 15th in those months).',
    },
    rules: {
      zaken: 'molad zaken (at or after noon)',
      gatarad: 'GaTaRaD',
      betutakpat: 'BeTUTaKPaT',
      adu: 'lo ADU Rosh (not Sunday, Wednesday, or Friday)',
    },
    kinds: { deficient: 'deficient', regular: 'regular', complete: 'complete' },
    before: 'before',
    after: 'after',
    leapYes: 'is leap',
    leapNo: 'is common',
    hasLeap: 'has a leap month: the first month without a principal solar term',
    noLeap: 'has no leap month',
    errors: {
      whole: 'Use whole numbers for the year, month, and day.',
      month: 'That calendar has no such month.',
      day: 'That month does not have that day.',
      huge: 'Use a year within a million years.',
      hebrewYear: 'Hebrew years start at 1 (3761 BCE).',
      islamicYear: 'Islamic years start at 1 (622 CE).',
      persianYear: 'Solar Hijri dates here run from 379 to 2379 SH (1000 to 3000 CE).',
      chineseYear: 'Chinese dates here run from 1645 to 2400 CE.',
      positiveYear: 'Use a year of 1 or later in that calendar.',
      beforeEpoch: 'That day is before the calendar began.',
      maya: 'Type five whole numbers such as 13.0.0.0.0. The second from the right goes up to 17, the others up to 19.',
      eraLine: 'Write each era as a date (YYYY-MM-DD), a comma, and its name.',
      roman: 'Roman numerals here go from 1 to 3999.',
      number: 'Type a number.',
      unknown: 'That date could not be converted.',
    },
  },
  textlab: {
    title: 'Text analysis and verse',
    open: 'Open text analysis and verse',
    keywords:
      'readability Flesch word count frequency concordance KWIC collocation keyness ' +
      'compare versions variants MLU scansion meter hexameter rhyme',
    modes: 'Text tools',
    tabs: {
      read: 'Readability',
      words: 'Word lists',
      kwic: 'Concordance',
      keyness: 'Keyness',
      compare: 'Compare versions',
      sample: 'Language sample',
      verse: 'Scansion',
    },
    text: 'Text',
    textHint: 'Paste or type the text.',
    example: 'The cat sat on the mat.',
    rows: {
      words: 'Words',
      sentences: 'Sentences',
      syllables: 'Syllables',
      fleschEase: 'Flesch Reading Ease',
      fleschKincaid: 'Flesch-Kincaid grade',
      fog: 'Gunning fog index',
      smog: 'SMOG grade',
      colemanLiau: 'Coleman-Liau index',
      ari: 'Automated Readability Index',
      ttr: 'Type-token ratio',
      mattr: 'Moving-average type-token ratio (50 words)',
      types: 'Different words',
      utterances: 'Utterances',
      morphemes: 'Morphemes',
      mluMorphemes: 'MLU in morphemes',
      mluWords: 'MLU in words',
      ndw: 'Number of different words',
      meter: 'Best-fit meter',
      scheme: 'Rhyme scheme',
      pattern: 'Pattern',
      g2: 'Log-likelihood (G²)',
      logRatio: 'Log ratio (effect size)',
    },
    syllableNote: 'Syllables are counted by spelling rules, so an unusual word can be off by one.',
    lengths: 'Words in each sentence: {list}',
    flagsTitle: 'Flags (local heuristics)',
    flagKinds: { passive: 'Possible passive', nominalization: 'Nominalization', hedge: 'Hedge' },
    noFlags: 'No passives, nominalizations, or hedges were flagged.',
    skipStop: 'Leave out common function words',
    gram: 'Words in each n-gram',
    top: 'Most frequent',
    headerWord: 'Word',
    headerCount: 'Count',
    zipfRank: 'Rank (log scale)',
    zipfFrequency: 'Frequency (log scale)',
    zipfAlt: 'Zipf plot: the logarithm of frequency against the logarithm of rank for {count} words.',
    query: 'Word or phrase',
    span: 'Words of context each side',
    sort: 'Sort by',
    sorts: { order: 'Order in the text', left: 'Left context', right: 'Right context' },
    kwicHeader: { left: 'Left', key: 'Key', right: 'Right' },
    hits: '{count, plural, one {# line} other {# lines}}',
    collocatesTitle: 'Collocates within the window',
    collocateHeader: {
      word: 'Collocate',
      observed: 'Together',
      frequency: 'Total',
      mi: 'MI (bits)',
      t: 't-score',
      g2: 'G²',
    },
    noCollocates: 'No word appears near it at least twice.',
    target: 'Study text',
    reference: 'Reference text',
    keyWord: 'Word to test',
    keynessValue: '{word}: {a} in {n1} words against {b} in {n2} words.',
    keynessSteps: {
      table: 'The 2 × 2 table: {a} and {b} uses, {c} and {d} other words.',
      formula:
        'G² = 2 Σ O ln(O/E), each E = row total × column total ÷ {n}. G² over 3.84 is significant at p < 0.05 (1 degree of freedom).',
    },
    keyList: 'Words most typical of the study text',
    base: 'Base text',
    witness: 'Witness text',
    variantsTitle: 'Variants',
    variantHeader: { at: 'Base word', base: 'Base reads', witness: 'Witness reads' },
    omitted: '(omitted)',
    noVariants: 'The two texts read the same, word for word.',
    sample: 'Utterances',
    sampleHint: 'One utterance a line. Mark morphemes with hyphens, such as eat-ing or dog-s.',
    sampleExample: 'doggie go\nmommy eat-ing\nbig dog-s run',
    language: 'Language',
    languages: { english: 'English (stress)', latin: 'Latin (quantity)' },
    lines: 'Lines of verse',
    linesHint:
      'One line of verse a line. For Latin, macrons (ā) mark long vowels; without them a vowel’s length is open.',
    verseExample: "Shall I compare thee to a summer's day?\nThou art more lovely and more temperate:",
    latinExample: 'Arma virumque cano, Troiae qui primus ab oris',
    meters: { iambic: 'iambic', trochaic: 'trochaic', anapestic: 'anapestic', dactylic: 'dactylic' },
    lineLengths: {
      n1: 'monometer',
      n2: 'dimeter',
      n3: 'trimeter',
      n4: 'tetrameter',
      n5: 'pentameter',
      n6: 'hexameter',
      n7: 'heptameter',
      n8: 'octameter',
    },
    englishLine: 'Line {number}: {count, plural, one {# syllable} other {# syllables}}, {meter}. Stress: {pattern}.',
    latinLine: 'Line {number}: {syllables}',
    weights: { long: '–', short: '∪', either: '×', unknown: '?', anceps: '×' },
    hexameter: 'Hexameter: {patterns}',
    pentameter: 'Pentameter: {patterns}',
    noFit: 'No hexameter or pentameter fits these weights. Check the line, or add macrons.',
    ambiguous: 'More than one pattern fits; mark long vowels with macrons to decide.',
    elided: 'Elided: {words}',
    verseSteps: {
      english:
        'Stress comes from English spelling rules. Function words are light. ' +
        'Words of 2 syllables with a prefix such as com- or re- stress the second syllable, and others stress the first. ' +
        'The meter whose pattern differs least wins.',
      latin:
        'A Latin syllable is long by nature (a macron), as a diphthong (ae, au, oe), ' +
        'or by position (a vowel before 2 consonants; x and z count as 2). ' +
        'Mute and liquid (as in tr) may go either way, and a vowel before a vowel is short.',
      key: '– long, ∪ short, × either or anceps, ? open: the vowel’s own length is not marked.',
    },
    errors: {
      empty: 'Type some text first.',
      ngram: 'Use n-grams of 1 to 6 words.',
      query: 'Type a word or phrase to find.',
      notFound: 'That word is not in the text.',
      positive: 'Use counts of 0 or more and corpus sizes larger than 0.',
      tooLong: 'Those texts are too long to compare here. Use up to about 2,000 words each.',
      number: 'Type a number.',
      unknown: 'That text could not be analyzed.',
    },
  },
  linguistics: {
    title: 'Linguistic structures',
    open: 'Open linguistic structures',
    keywords:
      'syntax tree bracket dependency interlinear gloss Leipzig distinctive features natural class ' +
      'phonological rule derivation sound change syllable sonority vowel formant Lobanov Bark',
    modes: 'Linguistics tools',
    tabs: {
      trees: 'Trees',
      gloss: 'Glosses',
      features: 'Features',
      rules: 'Rules',
      syllables: 'Syllables',
      vowels: 'Vowel chart',
    },
    treeKind: 'Kind of tree',
    treeKinds: { syntax: 'Syntax tree from brackets', dependency: 'Dependency tree' },
    brackets: 'Labeled brackets',
    bracketsHint: 'Such as [S [NP the cat] [VP sat]]. End a label with ^ for a triangle, as in [NP^ the old cat].',
    bracketAt: '{problem} (at character {position})',
    dependencies: 'Words with their heads',
    dependenciesHint: 'One word a line: the word, the number of its head (0 for the root), and the relation.',
    syntaxTitle: 'Syntax tree',
    syntaxAlt: 'A syntax tree with root {root} over the words: {words}',
    dependencyTitle: 'Dependency tree',
    dependencyAlt: 'A dependency tree of {count} words with the root {root}',
    outlineStep: 'Each line is a node, indented under its parent:',
    rows: {
      root: 'Root',
      words: 'Words',
      phrases: 'Phrase nodes',
      depth: 'Levels from root to word',
      syllables: 'Syllables',
    },
    rootHead: 'root',
    projective: 'No arcs cross, so the tree is projective.',
    nonProjective: 'Arcs cross, so the tree is not projective. Crossing pairs, by dependent: {pairs}.',
    headerNumber: 'Number',
    headerWord: 'Word',
    headerHead: 'Head',
    headerRelation: 'Relation',
    headerMorpheme: 'Morpheme',
    headerGloss: 'Gloss',
    headerSegment: 'Segment',
    headerStage: 'Stage',
    headerVowel: 'Vowel',
    headerTokens: 'Tokens',
    example: 'Example line',
    glossLine: 'Gloss line',
    glossHint: 'Join morphemes with hyphens and clitics with equals signs, as in the example line.',
    translation: 'Free translation',
    glossAligned: 'Every word and morpheme has a gloss.',
    glossTable: 'Interlinear gloss',
    morphemeTable: 'Morphemes and glosses',
    glossProblems: {
      missingGloss: 'Word {position}, {word}, has no gloss.',
      extraGloss: 'Gloss {position}, {word}, has no word.',
      morphemes: 'Word {position}, {word}, has {forms} morphemes but {glosses} glosses.',
      joiners: 'Word {position}, {word}, uses different hyphens, and equals signs from its gloss.',
    },
    labelsStep: 'The grammatical labels, from the standard abbreviations of the Leipzig Glossing Rules:',
    labelMeaning: '{label}: {meaning}',
    labelUnknown: '{label}: not on the standard list, so give its meaning in a note.',
    bundle: 'Feature bundle',
    bundleHint: 'Such as [+voice -sonorant]. Short names work too: syl, cons, son, cont, nas, voi.',
    segmentSet: 'Segments to test as a class',
    segmentPair: 'Two segments to compare',
    classEmpty: 'No segment in the chart has all these features.',
    classMembers: '{bundle}: {members}',
    natural: 'A natural class. The shared features {shared} pick out exactly these segments.',
    notNatural: 'Not a natural class. The shared features {shared} also take in: {members}.',
    unknownSegments: 'These are not in the chart: {list}. Add them in the changes to the chart.',
    difference: '{a} and {b} differ in: {list}.',
    noDifference: 'These 2 segments have the same features in this chart.',
    edits: 'Changes to the chart',
    editsHint: 'One a line: a segment, =, a chart segment, and what differs, as in ɲ = n -ant +dor +high -back.',
    chartTitle: 'Feature chart',
    chartNote:
      'This chart was written for OpenNote from the usual articulatory descriptions; 0 means the feature does not ' +
      'apply. Textbooks differ on some values, so match your course’s chart with the changes field.',
    rules: 'Rules in order',
    rulesHint:
      'One a line, as A -> B / C _ D. Use V, C, [features], # for a word edge, 0 for nothing, and ( ) for optional.',
    forms: 'Underlying forms',
    formsHint: 'One a line, with or without slashes. Sound changes in order work the same way.',
    derivation: 'Derivation',
    surface: 'Surface form',
    ruleStep: '/{form}/: rule {rule} gives {result}.',
    noChange: 'No rule changed any form.',
    interaction: '/{form}/: rules {first} and {second} are in a {kind} order.',
    interactions: {
      feeding: 'feeding',
      bleeding: 'bleeding',
      counterfeeding: 'counterfeeding',
      counterbleeding: 'counterbleeding',
    },
    word: 'Word',
    onsets: 'Legal onsets',
    onsetsHint: 'Such as p, n, d, tr. Leave empty to allow any onset that rises in sonority.',
    onsetStep: 'Each vowel is a nucleus. Between vowels, the longest legal onset goes with the next vowel.',
    sonorityStep:
      'Each vowel is a nucleus. Between vowels, the longest run that rises in sonority (stop, fricative, nasal, ' +
      'liquid, glide) goes with the next vowel.',
    splitStep: 'The cluster {cluster} splits into the coda {coda} and the onset {onset}.',
    formants: 'Formants',
    formantsHint: 'One token a line: the vowel, F1 and F2 in hertz, and a speaker if there is more than 1.',
    formantExample: 'i 280 2250 A\ni 300 2350 A\nɛ 550 1850 A\na 750 1300 A\nɔ 600 900 A\nu 320 850 A',
    scale: 'Scale',
    scales: { hz: 'Hertz', lobanov: 'Lobanov z-scores', bark: 'Bark' },
    scaleUnits: { hz: 'Hz', lobanov: 'z', bark: 'Bark' },
    scaleSteps: {
      hz: 'F2 runs from right to left and F1 from top to bottom, so front high vowels sit at the top left.',
      lobanov: 'For each speaker and formant, z = (F − mean) ÷ sd, with the sample standard deviation.',
      bark: 'Each formant f in hertz becomes 26.81 f ÷ (1960 + f) − 0.53 Bark (Traunmüller, 1990).',
    },
    vowelTitle: 'Vowel chart',
    vowelAlt: 'A vowel chart of: {list}',
    axisF1: 'F1 ({unit})',
    axisF2: 'F2 ({unit})',
    errors: {
      empty: 'Type something first.',
      start: 'Start with a [ and a label.',
      label: 'Give this bracket a label.',
      unclosed: 'This bracket is not closed.',
      extraClose: 'This ] has no [ to close.',
      trailing: 'Put everything inside one outer bracket.',
      triangle: 'A triangle covers words only; take the inner brackets out.',
      tooMany: 'That is more than this tool takes at once.',
      depLine: 'Give each word the number of its head.',
      depHead: 'A head must be the number of another word, or 0 for the root.',
      depRoot: 'Give exactly 1 word the head 0.',
      depCycle: 'These heads go round in a circle.',
      feature: 'That feature is not in the chart. Write it as +voice or -son.',
      noFeatures: 'Type at least 1 feature.',
      edit: 'Write a change as ɲ = n -ant +dor.',
      editBase: 'Start a change from a segment in the chart.',
      unknownSegment: 'That segment is not in the chart.',
      pair: 'Type 2 segments.',
      bracket: 'A bracket or parenthesis is not closed.',
      optional: 'Use fewer optional elements in one rule.',
      arrow: 'Write each rule with an arrow, as a -> e / _ i.',
      target: 'Start the rule with segments, a class, or 0.',
      change: 'Say what the target becomes, or 0 to delete it.',
      featureChange: 'A feature change works on 1 segment at a time.',
      focus: 'Put 1 underscore where the target goes.',
      noSegment: 'No segment in the chart has the features this rule makes.',
      noRules: 'Type at least 1 rule.',
      noForms: 'Type at least 1 form.',
      noVowel: 'This word has no vowel to be a nucleus.',
      formantLine: 'Give each token a vowel, F1, and F2.',
      number: 'Type numbers for F1 and F2.',
      positive: 'Formants are larger than 0 Hz.',
      fewTokens: 'Lobanov needs at least 2 tokens from each speaker.',
      noSpread: 'All of a speaker’s values are the same, so they cannot be scaled.',
      unknown: 'That could not be worked out.',
    },
  },
  scripts: {
    title: 'Scripts, keyboards, and romanization',
    open: 'Open scripts, keyboards, and romanization',
    keywords:
      'IPA keyboard Greek Cyrillic Arabic Hebrew Devanagari Armenian Georgian runes romanization transliteration ' +
      'ALA-LC BGN Hangul Revised Romanization McCune Reischauer kana Hepburn pinyin tone sandhi Thai Vietnamese Telex',
    modes: 'Script tools',
    tabs: {
      keyboards: 'Keyboards',
      romanize: 'Romanize',
      korean: 'Korean',
      japanese: 'Japanese',
      chinese: 'Pinyin',
      thai: 'Thai tones',
      vietnamese: 'Vietnamese',
    },
    keyboard: 'Keyboard',
    palettes: {
      ipa: 'International Phonetic Alphabet',
      greek: 'Greek with breathings and accents',
      latin: 'Latin with macrons and breves',
      oldEnglish: 'Old English',
      cyrillic: 'Cyrillic',
      arabic: 'Arabic and Persian',
      hebrew: 'Hebrew with niqqud',
      devanagari: 'Devanagari',
      armenian: 'Armenian',
      georgian: 'Georgian',
      runic: 'Runic',
      ancient: 'Linear B, cuneiform, and hieroglyphs',
      jefferson: 'Jefferson transcription',
    },
    groups: {
      plosive: 'Plosives',
      nasal: 'Nasals',
      trill: 'Trills, taps, and flaps',
      fricative: 'Fricatives',
      approximant: 'Approximants',
      nonPulmonic: 'Clicks, implosives, and ejectives',
      vowel: 'Vowels, from close front to open back',
      diacritic: 'Diacritics',
      suprasegmental: 'Stress, length, breaks, and tones',
      letters: 'Letters',
      marks: 'Breathings, accents, and iota subscript',
      macrons: 'Macrons',
      breves: 'Breves',
      russian: 'Russian',
      others: 'Other Cyrillic letters',
      persian: 'Persian letters',
      harakat: 'Harakat',
      niqqud: 'Niqqud',
      vowels: 'Vowels',
      consonants: 'Consonants',
      signs: 'Vowel signs and marks',
      futhark: 'Elder Futhark',
      linearB: 'Linear B syllables',
      cuneiform: 'Cuneiform signs',
      hieroglyphs: 'Egyptian hieroglyphs',
      symbols: 'Overlap, latching, pauses, pitch, and breath',
    },
    compose: 'Compose',
    composeHint: 'The keys type here. Edit it as you like, then insert it.',
    keyName: '{key}, {code}',
    keyboardNote: 'A mark on a dotted circle joins the letter before it. Ancient scripts need a font that has them.',
    scheme: 'Scheme',
    schemes: {
      'ru-alalc': 'Russian, ALA-LC',
      'ru-bgn': 'Russian, BGN/PCGN',
      'ru-reverse': 'ALA-LC back to Russian Cyrillic',
      'el-alalc': 'Modern Greek, ALA-LC',
      'hi-alalc': 'Devanagari, ALA-LC',
      'hy-alalc': 'Armenian, ALA-LC',
      'ka-alalc': 'Georgian, ALA-LC',
    },
    samples: {
      'ru-alalc': 'Чайковский',
      'ru-bgn': 'Ельцин',
      'ru-reverse': 'Chaĭkovskiĭ',
      'el-alalc': 'Αθήνα',
      'hi-alalc': 'संस्कृत',
      'hy-alalc': 'Հայաստան',
      'ka-alalc': 'თბილისი',
    },
    schemeSteps: {
      'ru-alalc': 'Each letter has its own spelling: й is ĭ, ы is y, э is ė, ю is i͡u, and я is i͡a.',
      'ru-bgn': 'е is ye at the start of a word and after a vowel, й, ъ, or ь; й is y; ь is ’.',
      'ru-reverse': 'ALA-LC gives each Russian letter its own spelling, so it reads back letter by letter.',
      'el-alalc': 'η is ē and ω is ō; γγ is ng; αυ, ευ, and ου are au, eu, and ou; a rough breathing is h.',
      'hi-alalc': 'Each consonant carries an a unless a vowel sign or a virama follows; ं is ṃ and ः is ḥ.',
      'hy-alalc': 'Aspirated letters take ʻ, as in tʻ; ու is u and և is ew.',
      'ka-alalc': 'Aspirated letters take ʻ, as in tʻ and kʻ; ყ is q.',
    },
    sourceNote:
      'Tables: Library of Congress ALA-LC Romanization Tables and the BGN/PCGN systems, in the public domain.',
    source: 'Text',
    result: 'Result',
    hangul: 'Hangul',
    hangulHint: 'Type Hangul syllables, or jamo such as ㅎㅏㄴ to build a syllable.',
    asName: 'Capitalize as a name',
    rr: 'Revised Romanization',
    mr: 'McCune–Reischauer',
    jamoTable: 'Syllables and their jamo',
    syllable: 'Syllable',
    codePoint: 'Code point',
    hangulFormula: 'Each syllable is 0xAC00 + (L × 21 + V) × 28 + T, with L, V, and T the numbers of its jamo.',
    noSoundRules: 'No sound changes apply at the joins between these syllables.',
    soundRules: {
      liaison: 'A final before an empty onset moves over to begin the next syllable.',
      nasal: 'A stop final becomes a nasal before n or m: k to ng, t to n, p to m.',
      lateral: 'n and l side by side are both read l.',
      lToN: 'l after a final other than n or l is read n.',
      aspiration: 'h next to a plain stop makes it aspirated, and the h is not written.',
      palatal: 't or th before i is read j or ch.',
    },
    direction: 'Direction',
    directions: { toRomaji: 'Kana to Hepburn', toKana: 'Romaji to kana' },
    hepburn: 'Hepburn',
    hiragana: 'Hiragana',
    katakana: 'Katakana',
    hepburnSteps:
      'Long vowels take a macron (ou, oo, and the long mark ー), a small tsu doubles the next consonant, and n is ' +
      "written n' before a vowel or y.",
    kanaChart: 'The kana chart',
    pinyin: 'Pinyin with tone numbers',
    pinyinHint: 'Such as zhong1 guo2. Write ü as v or u:, and 5 or no number for the neutral tone.',
    citation: 'Tone marks',
    spoken: 'Spoken, after sandhi',
    markRule: 'The mark goes on an a or an e, on the o of ou, and otherwise on the last vowel: liú, guì.',
    sandhiRules: {
      third: '{syllable}: a third tone before another third tone is said as a second tone ({from} to {to}).',
      yi: '{syllable}: yi is second tone before a fourth tone and fourth tone before the others ({from} to {to}).',
      bu: '{syllable}: bu is second tone before a fourth tone ({from} to {to}).',
    },
    thai: 'Thai syllable',
    thaiHint: 'One written syllable, such as ข้าว.',
    initial: 'First consonant',
    class: 'Consonant class',
    syllableKind: 'Syllable',
    live: 'live',
    dead: 'dead',
    mark: 'Tone mark',
    tone: 'Tone',
    classes: { high: 'high', mid: 'mid', low: 'low' },
    marks: {
      none: 'none',
      ek: 'mai ek ( ่ )',
      tho: 'mai tho ( ้ )',
      tri: 'mai tri ( ๊ )',
      chattawa: 'mai chattawa ( ๋ )',
    },
    tones: { mid: 'mid', low: 'low', falling: 'falling', high: 'high', rising: 'rising' },
    led: {
      ho: 'A silent ห before a low sonorant makes the syllable high class.',
      o: 'A silent อ before ย makes the syllable mid class.',
    },
    thaiRule: 'A {cls} class consonant in a {kind} syllable with the mark {mark} gives the {tone} tone.',
    method: 'Input method',
    methods: { telex: 'Telex', vni: 'VNI' },
    typed: 'Typed text',
    methodSteps: {
      telex: 'aa â, ee ê, oo ô, aw ă, ow ơ, uw ư, dd đ; end a word with s, f, r, x, or j for the 5 marked tones.',
      vni: '1 to 5 for the tones, 6 for the circumflex, 7 for the horn, 8 for the breve, and 9 for đ.',
    },
    toneRule:
      'The tone mark goes on a vowel with a mark of its own (ơ in ươ); otherwise on the last vowel of a closed ' +
      'syllable, the middle of 3 vowels, or the first of 2.',
    errors: {
      empty: 'Type something first.',
      jamo: 'Those jamo numbers are out of range.',
      jamoOrder: 'Type jamo in order: a consonant, a vowel, then an optional final.',
      notHangul: 'That is not a Hangul syllable.',
      notThai: 'Type a Thai syllable.',
      unknown: 'That could not be converted.',
    },
  },
} as const;
