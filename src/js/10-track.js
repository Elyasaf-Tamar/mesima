const Track = (() => {
  async function books(title){
    const url = 'https://www.googleapis.com/books/v1/volumes?maxResults=3&q=' +
                encodeURIComponent('intitle:' + title);
    const r = await fetch(url);
    if (!r.ok) throw new Error('books ' + r.status);
    const j = await r.json();
    const v = (j.items || [])[0];
    if (!v) throw new Error('לא נמצא');
    const i = v.volumeInfo || {};
    return { title:i.title || title, date:i.publishedDate || '',
             by:(i.authors||[]).join(', '), img:(i.imageLinks||{}).thumbnail || '' };
  }
  const searchUrl = (q, kind) => kind === 'game'
    ? 'https://www.google.com/search?q=' + encodeURIComponent(q + ' release date game')
    : 'https://www.google.com/search?q=' + encodeURIComponent(q + ' תאריך יציאה');
  return { books, searchUrl };
})();

/* ------------------------------- Native --------------------------------- */
/* קיים רק בתוך ה-APK. בדפדפן A הוא undefined והכול ממשיך לעבוד כרגיל. */
