import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { errMsg } from '../lib/format';
import { parseCsv } from '../lib/csv';
import { useLookups } from '../context/LookupContext';
import { Button, Card, Modal, useToast } from './ui';

type RosterRow = {
  cluster: string;
  state: string;
  category: 'sps' | 'satsang';
  hasIE: boolean;
  name: string;
  center: string;
  secondaryCenter: string;
  phone: string;
  gender: string;
  foundationEmail: string;
  personalEmail: string;
  email: string;
  languages: string[];
  batch: string;
  expertise: string;
  details: string[];
};

type ExistingPerson = {
  id: string;
  full_name: string;
  email: string | null;
  foundation_email: string | null;
  personal_email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  center: string | null;
  secondary_center: string | null;
  cluster: string | null;
  batch: string | null;
  gender: string | null;
  area_of_expertise: string | null;
  region: string;
  is_active: boolean;
  notes: string | null;
  languages: string[];
};

const clean = (value: string | undefined) => (value ?? '').trim();
const norm = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '');

const clusterForState = (state: string) => {
  const key = norm(state);
  if (['punjab', 'jammu'].includes(key)) return 'Punjab & Jammu Cluster';
  if (['haryana', 'himachalpradesh', 'uttarakhand'].includes(key)) return 'Haryana & HP & UK Cluster';
  if (key === 'rajasthan') return 'Rajasthan Cluster';
  return '';
};

const inferState = (state: string, ...centers: string[]) => {
  if (state) return state;
  const location = centers.map(norm).find((value) => value in { dehradun: 1, shimla: 1, dharamshala: 1 });
  if (location === 'dehradun') return 'Uttarakhand';
  if (location === 'shimla' || location === 'dharamshala') return 'Himachal Pradesh';
  return '';
};

function parseRoster(text: string): { rows: RosterRow[]; updateDate: string } {
  const table = parseCsv(text);
  const headerIndex = table.findIndex((row) => {
    const header = row.map(norm);
    return header.includes('state') && header.includes('name') && (header.includes('ishanga') || header.includes('sps/satsang/ie')) && (header.includes('city') || header.includes('center'));
  });
  if (headerIndex < 0) throw new Error('Could not find the roster headers. Upload the downloaded roster CSV.');

  const header = table[headerIndex].map(norm);
  const index = (...keys: string[]) => header.findIndex((key) => keys.includes(key));
  const hasLegacyLayout = header.includes('ishanga');
  const stateIndex = index('state');
  const categoryIndex = index('ishanga', 'sps/satsang/ie');
  const nameIndex = index('name');
  const cityIndex = index('city', 'center');
  const secondCenterIndex = !hasLegacyLayout ? header.findIndex((key, i) => key === 'center' && i !== cityIndex) : -1;
  const phoneIndex = index('number', 'phone', 'mobilenumber');
  const emailIndex = index('email');
  const foundationEmailIndex = index('foundationemail');
  const personalEmailIndex = index('personalemail');
  const genderIndex = index('malefemale', 'gender');
  const languageIndex = index('language', 'langauge', 'traininglanguage');
  const batchIndex = index('batch');
  const remarksIndex = index('remarks');
  const centerRolesIndex = hasLegacyLayout ? index('center') : -1;
  const regionalIndex = index('regional');
  const ashramIndex = index('ashram');
  const expertiseIndex = index('areaofexpertise');
  const updateDate = table.slice(0, headerIndex).flat().join(' ').match(/Latest Update:\s*([^,]+)/i)?.[1]?.trim() ?? '';

  let cluster = '';
  let state = '';
  const rows: RosterRow[] = [];
  for (const cells of table.slice(headerIndex + 1)) {
    const first = clean(cells[0]);
    if (first && /cluster$/i.test(first) && cells.slice(1).every((cell) => !clean(cell))) {
      cluster = first;
      state = '';
      continue;
    }
    if (first && stateIndex === 0) state = first;
    else if (clean(cells[stateIndex])) state = clean(cells[stateIndex]);
    const name = clean(cells[nameIndex]);
    const categoryText = clean(cells[categoryIndex]).toLowerCase();
    if (!name || (!categoryText.includes('sps') && !categoryText.includes('satsang') && !categoryText.includes('ie'))) continue;
    const category = categoryText.includes('sps') && !categoryText.includes('satsang') ? 'sps' : 'satsang';
    const center = clean(cells[cityIndex]);
    const secondaryCenter = clean(cells[secondCenterIndex]);
    const rowState = inferState(hasLegacyLayout ? state : clean(cells[stateIndex]), center, secondaryCenter) || state;
    const rowCluster = cluster || clusterForState(rowState);

    const language = clean(cells[languageIndex]);
    const details = [
      clean(cells[remarksIndex]) && `Remarks: ${clean(cells[remarksIndex])}`,
      clean(cells[centerRolesIndex]) && `Center responsibilities: ${clean(cells[centerRolesIndex])}`,
      clean(cells[regionalIndex]) && `Regional responsibilities: ${clean(cells[regionalIndex])}`,
      clean(cells[ashramIndex]) && `Ashram responsibilities: ${clean(cells[ashramIndex])}`,
    ].filter(Boolean) as string[];
    const expertise = clean(cells[expertiseIndex]);
    const legacyEmail = clean(cells[emailIndex]);
    const foundationEmail = clean(cells[foundationEmailIndex]) || (hasLegacyLayout ? legacyEmail : '');
    const personalEmail = clean(cells[personalEmailIndex]) || (hasLegacyLayout ? legacyEmail : '');

    rows.push({
      cluster: rowCluster,
      state: rowState,
      category,
      hasIE: categoryText.includes('ie'),
      name,
      center,
      secondaryCenter,
      phone: clean(cells[phoneIndex]),
      gender: clean(cells[genderIndex]),
      foundationEmail,
      personalEmail,
      email: foundationEmail || personalEmail || legacyEmail,
      languages: language.toLowerCase() === 'both' ? ['Hindi', 'English'] : language ? [language] : [],
      batch: clean(cells[batchIndex]),
      expertise,
      details,
    });
  }
  return { rows, updateDate };
}

const normalizedPhone = (phone: string | null) => (phone ?? '').replace(/\D/g, '');
const normalizedName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function mergeDetails(existing: string | null, details: string[], updateDate: string) {
  const marker = '\n\nRoster details:';
  const personalNotes = (existing ?? '').split(marker)[0].trim();
  const roster = [...(updateDate ? [`Roster updated: ${updateDate}`] : []), ...details];
  return [personalNotes, roster.length ? `Roster details:\n${roster.join('\n')}` : ''].filter(Boolean).join('\n\n') || null;
}

export default function PeopleRosterImport({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { ishangaTypes, attributes } = useLookups();
  const toast = useToast();
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [updateDate, setUpdateDate] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const selectFile = async (file?: File) => {
    setRoster(null);
    setFileName(file?.name ?? '');
    setError('');
    if (!file) return;
    try {
      const parsed = parseRoster(await file.text());
      if (!parsed.rows.length) throw new Error('No Satsang or SPS Ishangas were found in this file.');
      if (parsed.rows.some((row) => !row.cluster || !row.state)) throw new Error('Some Ishangas are missing a cluster or state heading.');
      setRoster(parsed.rows);
      setUpdateDate(parsed.updateDate);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const importRoster = async () => {
    if (!roster?.length) return;
    const spsType = ishangaTypes.find((type) => type.name.toLowerCase() === 'sps ishanga');
    const satsangType = ishangaTypes.find((type) => type.name.toLowerCase() === 'satsang ishanga');
    if (!spsType || !satsangType) return setError('Set up the SPS Ishanga and Satsang Ishanga types before importing.');
    const ieAttribute = attributes.find((attribute) => norm(attribute.name) === 'ieishanga');
    if (roster.some((row) => row.hasIE) && !ieAttribute) return setError('Set up the IE-Ishanga attribute before importing this roster.');

    setBusy(true);
    setError('');
    const { data: current, error: loadError } = await supabase
      .from('people')
      .select('id, full_name, email, foundation_email, personal_email, phone, city, state, center, secondary_center, cluster, batch, gender, area_of_expertise, region, is_active, notes, languages');
    if (loadError) {
      setBusy(false);
      return setError(errMsg(loadError));
    }

    const existing = (current ?? []) as ExistingPerson[];
    const rosterTypeIds = [spsType.id, satsangType.id];
    let imported = 0;
    const failures: string[] = [];
    for (let i = 0; i < roster.length; i++) {
      const row = roster[i];
      setProgress(`Importing ${i + 1} of ${roster.length}`);
      try {
        const phone = normalizedPhone(row.phone);
        const sameName = (person: ExistingPerson) => normalizedName(person.full_name) === normalizedName(row.name);
        const samePhone = (person: ExistingPerson) => !!phone && normalizedPhone(person.phone) === phone;
        const sourceEmails = [row.foundationEmail, row.personalEmail].filter(Boolean).map((value) => value.toLowerCase());
        const match = existing.find((person) => sameName(person) && samePhone(person)) || existing.find((person) => {
          const knownEmails = [person.email, person.foundation_email, person.personal_email].filter(Boolean).map((value) => value!.toLowerCase());
          return sourceEmails.some((sourceEmail) => knownEmails.includes(sourceEmail)) && (sameName(person) || samePhone(person));
        });
        const typeId = row.category === 'sps' ? spsType.id : satsangType.id;
        const personData = {
          full_name: row.name,
          phone: row.phone || match?.phone || null,
          email: row.email || match?.email || null,
          foundation_email: row.foundationEmail || match?.foundation_email || null,
          personal_email: row.personalEmail || match?.personal_email || null,
          city: match?.city ?? null,
          state: row.state,
          center: row.center || match?.center || null,
          secondary_center: row.secondaryCenter || match?.secondary_center || null,
          cluster: row.cluster,
          batch: row.batch || match?.batch || null,
          gender: row.gender || match?.gender || null,
          area_of_expertise: row.expertise || match?.area_of_expertise || null,
          region: 'North Region',
          is_active: match?.is_active ?? true,
          notes: mergeDetails(match?.notes ?? null, row.details, updateDate),
          languages: row.languages.length ? row.languages : match?.languages ?? [],
        };

        let personId = match?.id;
        if (personId) {
          const { error } = await supabase.from('people').update(personData).eq('id', personId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from('people').insert(personData).select('id').single();
          if (error) throw error;
          personId = data.id as string;
          existing.push({ ...personData, id: personId });
        }
        const { error: clearTypesError } = await supabase.from('person_types').delete().eq('person_id', personId).in('type_id', rosterTypeIds);
        if (clearTypesError) throw clearTypesError;
        const { error: typeError } = await supabase.from('person_types').upsert(
          { person_id: personId, type_id: typeId },
          { onConflict: 'person_id,type_id', ignoreDuplicates: true },
        );
        if (typeError) throw typeError;
        if (row.hasIE && ieAttribute) {
          const { error: attributeError } = await supabase.from('person_attributes').upsert(
            { person_id: personId, attribute_id: ieAttribute.id },
            { onConflict: 'person_id,attribute_id', ignoreDuplicates: true },
          );
          if (attributeError) throw attributeError;
        }
        imported++;
      } catch (e) {
        failures.push(`${row.name}: ${errMsg(e)}`);
      }
    }

    setBusy(false);
    setProgress('');
    if (failures.length) {
      setError(`Imported ${imported} of ${roster.length}. ${failures.slice(0, 3).join(' · ')}`);
      if (imported) onImported();
      return;
    }
    toast(`Imported ${imported} Ishangas`);
    onImported();
    onClose();
  };

  const clusters = [...new Set((roster ?? []).map((row) => row.cluster))];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Ishanga roster"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={importRoster} disabled={busy || !roster?.length}>
            {busy ? progress || 'Importing…' : `Import ${roster?.length ?? 0} Ishangas`}
          </Button>
        </>
      }
    >
      <p className="text-sm text-stone-600">Select the roster CSV. Its first Center column maps to Center; the second is preserved separately. Region is set to North Region, and expertise and responsibilities are retained.</p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      {fileName && <div className="text-xs text-stone-500">{fileName}</div>}
      {roster && (
        <Card className="space-y-2 bg-stone-50">
          <div className="font-medium">{roster.length} rows ready</div>
          <div className="text-sm text-stone-600">{clusters.join(' · ')}</div>
          <div className="text-xs text-stone-500">Existing records are matched by email, or by name and phone. Re-imports update the matching person instead of adding a duplicate.</div>
        </Card>
      )}
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}