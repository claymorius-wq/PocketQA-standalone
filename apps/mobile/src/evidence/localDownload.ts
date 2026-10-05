/**
 * Saves a local object URL through a user-clicked download link. The bytes never leave the
 * browser: no request is made, and the file goes wherever the user's browser saves downloads.
 */
export function downloadLocal(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
