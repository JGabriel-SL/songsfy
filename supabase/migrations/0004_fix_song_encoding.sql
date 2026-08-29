-- Corrige títulos/artistas/gêneros que foram inseridos com mojibake (UTF-8 lido como cp1252)
-- pela seed original em 0001_init.sql. Converte de volta para UTF-8 correto.
update public.songs
set
  title  = convert_from(convert_to(title,  'WIN1252'), 'UTF8'),
  artist = convert_from(convert_to(artist, 'WIN1252'), 'UTF8'),
  genre  = convert_from(convert_to(genre,  'WIN1252'), 'UTF8')
where title  ~ '[ÃÂ]'
   or artist ~ '[ÃÂ]'
   or genre  ~ '[ÃÂ]';
