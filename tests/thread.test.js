import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeThreadUrl, parseThread } from '../server/lib/thread.js';

test('numbered thread keeps order and strips markers', () => {
  const r = parseThread('1/ First post about cats.\n2/ Second post about dogs.\nmore of second.\n3/3 Final post.');
  assert.deepEqual(r.posts, ['First post about cats.', 'Second post about dogs. more of second.', 'Final post.']);
});
test('blank-line separated posts and duplicates', () => {
  const r = parseThread('Post one here.\n\nPost two here.\n\nPost one here.');
  assert.deepEqual(r.posts, ['Post one here.', 'Post two here.']);
});
test('separator lines split posts', () => {
  assert.equal(parseThread('A line\n---\nB line').posts.length, 2);
});
test('thread url detection', () => {
  assert.ok(looksLikeThreadUrl('https://x.com/user/status/1'));
  assert.ok(looksLikeThreadUrl('https://twitter.com/user/status/1'));
  assert.ok(!looksLikeThreadUrl('https://example.com/x.com'));
});
