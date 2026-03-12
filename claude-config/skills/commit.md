# /commit — Stage and Commit Changes

Stage all changes and create a properly formatted commit.

## Steps

1. Run `git status` to check for changes
   - If no changes, output "Nothing to commit" and stop
2. Run `git add -A` to stage all changes
3. Format the commit message using the convention:
   - For issue implementation: `feat: implement #{iid} - {issue title}`
   - For bug fixes: `fix: {description}`
   - For docs: `docs: {description}`
   - For chores: `chore: {description}`
4. Run: `git commit -m "{message}"`
5. Output the commit SHA

## Input

The prompt should provide:
- Issue number (IID) if applicable
- Description or issue title

## Example Usage

Prompt: "Use /commit skill. Issue #3: Add user authentication"

Result:
```
git status → has changes
git add -A
git commit -m "feat: implement #3 - Add user authentication"
Committed: abc1234
```
