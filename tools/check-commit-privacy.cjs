const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const privateEmail = email => /^[^\s<>@]+@users\.noreply\.github\.com$/i.test(email);

try {
  if (process.argv.includes('--identity')) {
    for (const kind of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
      const email = git(['var', kind]).match(/<([^<>]+)>/)?.[1];
      if (!privateEmail(email || '')) throw new Error('Commit blocked: configure a GitHub noreply email for both author and committer.');
    }
  } else {
    let revisions;
    if (process.argv.includes('--pre-push')) {
      revisions = fs.readFileSync(0, 'utf8').trim().split('\n')
        .filter(Boolean).map(line => line.trim().split(/\s+/)[1])
        .filter(sha => !/^0+$/.test(sha));
    } else {
      revisions = process.argv.includes('--all') ? ['--all']
        : process.argv.includes('--current') ? [git(['rev-parse', 'HEAD'])] : process.argv.slice(2);
    }
    let count = 0;
    for (const revision of revisions) {
      if (revision !== '--all' && !/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error('Expected a commit hash.');
      const rows = git(['log', '--format=%ae%x09%ce%x09%cn', revision]).split('\n').filter(Boolean);
      for (const row of rows) {
        const [authorEmail, committerEmail, committerName] = row.split('\t');
        // This permits GitHub's public no-reply identity, not arbitrary bot addresses.
        // Email metadata is a privacy check, not proof of commit authenticity.
        const githubCommitter = committerName === 'GitHub' && committerEmail === 'noreply@github.com';
        if (!privateEmail(authorEmail) || (!privateEmail(committerEmail) && !githubCommitter)) throw new Error('Privacy check failed: reachable history contains a non-noreply author or committer email. Values are not printed.');
        count++;
      }
    }
    if (!revisions.length && !process.argv.includes('--pre-push')) throw new Error('Provide --current, --all, --identity, --pre-push or a commit hash.');
    console.log(`Commit privacy check passed (${count} history entries checked).`);
  }
} catch (error) {
  console.error(error.status !== undefined ? 'Privacy check could not inspect Git metadata; refusing to proceed.' : error.message);
  process.exitCode = 1;
}
