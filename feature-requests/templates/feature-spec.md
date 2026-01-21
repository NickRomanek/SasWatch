# Feature Specification Template

Use this template when adding new features to the backlog.

## Feature Metadata

- **ID**: `feature-short-name`
- **Title**: Short, descriptive title
- **Description**: What problem does this solve?
- **Priority**: 1 (High), 2 (Medium), 3 (Low)
- **Status**: `ready`, `in-progress`, `completed`, `blocked`
- **Estimated Complexity**: `low`, `medium`, `high`
- **Dependencies**: List of other feature IDs this depends on
- **Created**: YYYY-MM-DD

## Acceptance Criteria

List the specific, testable requirements:

1. [ ] Requirement 1
2. [ ] Requirement 2
3. [ ] Requirement 3

## Implementation Details

### Files to Modify

- `path/to/file1.js` - Why it needs changes
- `path/to/file2.js` - What changes are needed

### Protected Files

List any protected files (from `.cursor/rules/forbidden.md`) that need modification:
- If yes, **STOP and request approval before implementing**

### Database Changes

- [ ] Schema changes needed? (Requires approval)
- [ ] Migration needed?
- [ ] New Prisma model?

### API Changes

- [ ] New endpoint?
- [ ] Modified endpoint?
- [ ] Breaking change?

### Testing Requirements

- [ ] Unit tests
- [ ] Integration tests
- [ ] Multi-tenant isolation tests
- [ ] Manual testing steps

## Example Implementation

```javascript
// Example code structure (if helpful)
```

## Success Metrics

How will we know this feature works?

- Metric 1
- Metric 2

## Notes

Any additional context, concerns, or considerations.
