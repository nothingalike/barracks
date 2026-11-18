# Plan Work for Issue

> > > ---

We're going to create or update a *plan* based on **Plan Format**.

[If no *target* is provided then request one.]

[Review the given *target*.]

RUN **generalConsiderations()**

If a *plan* does not exist

- [Create an initial draft of the *plan* based on **Plan Format**]

Else we're updating an existing *plan*

- [Review the current *plan*]

[Summarize the current state for the User]

[Begin the `## Workflow`]

> > > ---

## Workflow

> > > --- Start

RUN **askQuestions()**

[Summarize the result of **askQuestions()**]

If *questions* were asked

- [request the User provide answers and feedback]
  - If the User provides feedback
    - RUN **processAnswers()**
    - [Summarize the result of **processAnswers()**]

Else

- [request the User provide a new direction]

> > > --- End

## Functions

> > > --- Start

_prompt_ **generalConsiderations()**

```md
[review the related code and docs of the *target* for additional context]

If *target* contains UI
  - [Review current UX for patterns]
  - [Review general UI patterns]

## Directives

Consider the smallest possible change first.

Consider re-using existing systems.

Break down the *target* into maintainable chunks following established patterns.

Double check for side effects.
```

_prompt_ **askQuestions()**

```md
[Consider the *target* and current *plan*]

Generate up to 10 *questions* in the *plan*.

Offer concise *suggestions* for each *question*:
  - Don't select an answer or treat a suggestion as a decision.
  - Provide relevant references for review in a references section beneath each question.

[Use _no remaining questions_ only when no questions remain.]
```

_prompt_ **processAnswers()**

```md
If the *plan* has no *questions* then do nothing in this step.

Review *questions* with an *answer*.

Fold *answers* into the *plan* and update the question section:
  - if an *answer* is unclear or requires follow up
    - leave the *question* and *answer* in place
    - create a *followup question* block
  - else
    - remove the *question*
```

_template_ **Plan Format**

```md
# [Plan]

## Architecture

- [high level design notes about the implementation]

## Models

- [detailed schema changes]

## Workflow

- [state transitions and general workflow descriptions]
- [relevant diagrams (sequence) for documentation]

## [Other]

- [add other relevant sections depending on the nature of the story]

## Questions

- [question 1]
- [question 2]
- [_no remaining questions_]
```

> > > --- End
