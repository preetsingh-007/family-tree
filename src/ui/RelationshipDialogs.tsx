import { useId, useState, type FormEvent } from 'react';
import { displayName } from '../model/names';
import { removeAssociation, removeParentLink, removePartnership, updateParentLink, updatePartnership } from '../model/tree';
import {
  PARENT_LINK_KINDS,
  PARTNERSHIP_END_REASONS,
  PARTNERSHIP_KINDS,
  type Association,
  type FamilyTreeDocument,
  type ParentLink,
  type ParentLinkKind,
  type Partnership,
  type PartnershipEnd,
  type PartnershipEndReason,
  type PartnershipKind,
  type Person,
} from '../model/types';
import { fromDateDraft, toDateDraft } from './dateDraft';
import { DateInput } from './DateInput';
import { END_REASON_LABELS, PARENT_KIND_LABELS, PARTNERSHIP_KIND_LABELS } from './labels';
import { ConfirmDialog, Modal } from './Modal';

type Apply = (label: string, change: (tree: FamilyTreeDocument) => FamilyTreeDocument) => string | undefined;

function Footer({ formId, onClose, onRemove, removeLabel }: { formId: string; onClose: () => void; onRemove: () => void; removeLabel: string }) {
  return (
    <>
      <button type="button" className="button button-danger-quiet footer-start" onClick={onRemove}>
        {removeLabel}
      </button>
      <button type="button" className="button" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" form={formId} className="button button-primary">
        Save
      </button>
    </>
  );
}

export function EditParentLinkDialog({
  link,
  parent,
  child,
  onApply,
  onClose,
}: {
  link: ParentLink;
  parent: Person;
  child: Person;
  onApply: Apply;
  onClose: () => void;
}) {
  const formId = useId();
  const [kind, setKind] = useState<ParentLinkKind>(link.kind);
  const [note, setNote] = useState(link.note ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const updated: ParentLink = { ...link, kind };
    if (note.trim()) updated.note = note.trim();
    else delete updated.note;
    const result = onApply('Edit parent relationship', (tree) => updateParentLink(tree, updated));
    if (result) setError(result);
    else onClose();
  };

  if (confirmRemove) {
    return (
      <ConfirmDialog
        title="Remove this relationship?"
        confirmLabel="Remove relationship"
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          const result = onApply('Remove parent relationship', (tree) => removeParentLink(tree, link.id));
          if (result) {
            setError(result);
            setConfirmRemove(false);
          } else onClose();
        }}
      >
        <p>
          {displayName(parent)} will no longer be recorded as a parent of {displayName(child)}. Both people stay in the tree.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <Modal
      title="Parent relationship"
      onClose={onClose}
      footer={<Footer formId={formId} onClose={onClose} onRemove={() => setConfirmRemove(true)} removeLabel="Remove relationship" />}
    >
      <form id={formId} className="stack" onSubmit={submit}>
        <p>
          <strong>{displayName(parent)}</strong> is a parent of <strong>{displayName(child)}</strong>.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-kind`}>
            Type of relationship
          </label>
          <select id={`${formId}-kind`} className="input" value={kind} onChange={(e) => setKind(e.target.value as ParentLinkKind)} data-autofocus>
            {PARENT_LINK_KINDS.map((k) => (
              <option key={k} value={k}>
                {PARENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-note`}>
            Note
          </label>
          <textarea id={`${formId}-note`} className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function EditPartnershipDialog({
  partnership,
  a,
  b,
  onApply,
  onClose,
}: {
  partnership: Partnership;
  a: Person;
  b: Person;
  onApply: Apply;
  onClose: () => void;
}) {
  const formId = useId();
  const [kind, setKind] = useState<PartnershipKind>(partnership.kind);
  const [startDate, setStartDate] = useState(toDateDraft(partnership.start?.date));
  const [startPlace, setStartPlace] = useState(partnership.start?.place ?? '');
  const [ended, setEnded] = useState(!!partnership.end);
  const [endReason, setEndReason] = useState<PartnershipEndReason | ''>(partnership.end?.reason ?? '');
  const [endDate, setEndDate] = useState(toDateDraft(partnership.end?.date));
  const [note, setNote] = useState(partnership.note ?? '');
  const [errors, setErrors] = useState<{ start?: string; end?: string; form?: string }>({});
  const [confirmRemove, setConfirmRemove] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const start = fromDateDraft(startDate, 'Start date');
    const end = ended ? fromDateDraft(endDate, 'End date') : { errors: [] };
    if (start.errors.length || end.errors.length) {
      setErrors({ start: start.errors.join(' ') || undefined, end: end.errors.join(' ') || undefined });
      return;
    }
    const updated: Partnership = { id: partnership.id, partnerIds: partnership.partnerIds, kind };
    if (start.date || startPlace.trim()) {
      updated.start = {};
      if (start.date) updated.start.date = start.date;
      if (startPlace.trim()) updated.start.place = startPlace.trim();
    }
    if (ended) {
      const endEvent: PartnershipEnd = {};
      if (endReason) endEvent.reason = endReason;
      if (end.date) endEvent.date = end.date;
      if (partnership.end?.place) endEvent.place = partnership.end.place;
      updated.end = endEvent;
    }
    if (note.trim()) updated.note = note.trim();
    const result = onApply('Edit partnership', (tree) => updatePartnership(tree, updated));
    if (result) setErrors({ form: result });
    else onClose();
  };

  if (confirmRemove) {
    return (
      <ConfirmDialog
        title="Remove this partnership?"
        confirmLabel="Remove partnership"
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          const result = onApply('Remove partnership', (tree) => removePartnership(tree, partnership.id));
          if (result) {
            setErrors({ form: result });
            setConfirmRemove(false);
          } else onClose();
        }}
      >
        <p>
          The partnership between {displayName(a)} and {displayName(b)}, including its dates and notes, will be removed. Their
          children stay linked to each of them.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <Modal
      title="Partnership"
      onClose={onClose}
      size="large"
      footer={<Footer formId={formId} onClose={onClose} onRemove={() => setConfirmRemove(true)} removeLabel="Remove partnership" />}
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <p>
          <strong>{displayName(a)}</strong> and <strong>{displayName(b)}</strong>
        </p>
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-kind`}>
            Type of relationship
          </label>
          <select id={`${formId}-kind`} className="input" value={kind} onChange={(e) => setKind(e.target.value as PartnershipKind)} data-autofocus>
            {PARTNERSHIP_KINDS.map((k) => (
              <option key={k} value={k}>
                {PARTNERSHIP_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <DateInput legend="Start date (e.g. wedding)" value={startDate} onChange={setStartDate} error={errors.start} />
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-place`}>
            Place
          </label>
          <input id={`${formId}-place`} className="input" value={startPlace} onChange={(e) => setStartPlace(e.target.value)} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={ended} onChange={(e) => setEnded(e.target.checked)} />
          This relationship has ended
        </label>
        {ended && (
          <>
            <div className="field">
              <label className="field-label" htmlFor={`${formId}-reason`}>
                How it ended
              </label>
              <select
                id={`${formId}-reason`}
                className="input"
                value={endReason}
                onChange={(e) => setEndReason(e.target.value as PartnershipEndReason | '')}
              >
                <option value="">Not recorded</option>
                {PARTNERSHIP_END_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {END_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <DateInput legend="End date" value={endDate} onChange={setEndDate} error={errors.end} />
          </>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-note`}>
            Note
          </label>
          <textarea id={`${formId}-note`} className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {errors.form && (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function RemoveAssociationDialog({
  association,
  from,
  to,
  onApply,
  onClose,
}: {
  association: Association;
  from: Person;
  to: Person;
  onApply: Apply;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title="Remove this relationship?"
      confirmLabel="Remove relationship"
      danger
      onCancel={onClose}
      onConfirm={() => {
        onApply('Remove relationship', (tree) => removeAssociation(tree, association.id));
        onClose();
      }}
    >
      <p>
        {displayName(from)} will no longer be recorded as {displayName(to)}’s {association.label}.
      </p>
    </ConfirmDialog>
  );
}
