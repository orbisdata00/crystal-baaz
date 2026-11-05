"""Generate navigation from all populated MAIN cells; never import commerce fields."""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from import_catalog import read_workbook, NS

ROOT = Path(__file__).resolve().parents[1]

def key(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())

def generate(path):
    workbook = read_workbook(path)
    main = workbook['MAIN']
    registry = json.loads((ROOT / 'src/data/catalog-registry.json').read_text())
    collections = {key(c['title']): c['handle'] for c in registry['collections']}
    groups = {key(c['title']): c['id'] for c in registry['groups']}
    # These aliases represent the same workbook form, not inferred memberships.
    aliases = {'Anklets':'Anklet', 'Diya':'Diyas', 'Gems Bracelets':'Gem Bracelets', 'Money Magnet':'Money'}
    sequence = [('best-seller','Best Seller'), ('new-arrivals','New Arrivals'), ('zodiac','Rashi | Zodiac'), ('bracelets','Bracelets'), ('rudraksha','Rudraksha'), ('crystals','Crystal'), ('pooja','Puja'), ('intentions','Remedy')]
    category_rows = [r['Main Categories'] for r in main['rows'] if r.get('Main Categories')]
    assert category_rows == [label for _, label in sequence], category_rows
    def item(label, row, parent):
        lookup = key(aliases.get(label,label))
        result = {'label':label,'sourceSheet':'MAIN','sourceRow':row,'sourceColumn':parent,'kind':'pending','target':key(label),'membershipVerified':False,'mappingIssue':'Product selection is being prepared.'}
        if lookup in groups:
            result.update(kind='group',target=groups[lookup],membershipVerified=True)
        elif lookup in collections:
            result.update(kind='collection',target=collections[lookup],membershipVerified=True)
        if result['membershipVerified']:
            result.pop('mappingIssue')
        return result
    parents = []
    for order,(id,label) in enumerate(sequence):
        children = [item(r[label],r['_row'],label) for r in main['rows'] if r.get(label)]
        p = {'id':id,'label':'Rashi / Zodiac' if id=='zodiac' else label,'displayOrder':order,'sourceSheet':'MAIN','sourceColumn':'Main Categories','sourceRow':order+2,'items':children,'kind':'category','target':id,'membershipVerified':True}
        if id=='best-seller':
            for c in children:
                if c['label']=='Money': c['rule']='money-magnet-main'
                if c['label']=='Kavach': c.update(kind='rule',target='kavach-main',membershipVerified=True,rule='kavach-main');c.pop('mappingIssue',None)
        if id=='new-arrivals':
            p.update(membershipVerified=False,pendingReason='New arrivals are being curated.',mappingIssue='No merchant-approved arrival list or trustworthy original arrival dates supplied; bulk import timestamps are excluded.')
        if id=='bracelets':
            p.update(kind='collection',target='bracelets')
        if id=='zodiac':
            for c in children:
                mappings={'Bracelet':('pending','rashibracelets'), 'Ring':('group','group-rashirings'), 'Pendant':('group','group-rashipendants'), 'Shop by rashi':('category','zodiac-signs')}
                kind,target=mappings.get(c['label'],('pending',key(c['label'])))
                c.update(kind=kind,target=target,membershipVerified=kind in ('group','category'))
                if kind=='category': c['relatedParentId']='zodiac-signs'
                if c['membershipVerified']:c.pop('mappingIssue',None)
        if id=='rudraksha':
            for c in children:
                explicit={'Bracelets':'group-rudrakshabracelet','Mala':'group-rudrakshamala'}
                if c['label'] in explicit:
                    c.update(kind='group',target=explicit[c['label']],membershipVerified=True);c.pop('mappingIssue',None)
                elif c['kind']=='collection':
                    c.update(membershipVerified=False,mappingIssue='Rudraksha-specific membership has not been supplied for this form.')
        parents.append(p)
    signs=[{'label':r['Shop By rashi'],'kind':'zodiac','target':r['Shop By rashi'].split(' ')[0], 'membershipVerified':False,'sourceRow':r['_row'],'mappingIssue':'Explicit product-to-sign membership is not supplied.'} for r in main['rows'] if r.get('Shop By rashi')]
    # Preserve cells beneath blank headers too: they contain essential client notes.
    with zipfile.ZipFile(path) as z:
        wb=ET.fromstring(z.read('xl/workbook.xml'));rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        targets={r.attrib['Id']:r.attrib['Target'] for r in rels}
        sheet=next(s for s in wb.findall('a:sheets/a:sheet',NS) if s.attrib['name']=='MAIN')
        target=targets[sheet.attrib[f"{{{NS['r']}}}id"]]; sheetpath=target.lstrip('/') if target.startswith('/') else 'xl/'+target
        strings=[''.join(n.text or '' for n in si.findall('.//a:t',NS)) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('a:si',NS)]
        cells=[]
        for c in ET.fromstring(z.read(sheetpath)).findall('.//a:c',NS):
            v=c.find('a:v',NS); inline=c.find('a:is',NS)
            val=''.join(n.text or '' for n in inline.findall('.//a:t',NS)) if inline is not None else (v.text or '' if v is not None else '')
            if c.get('t')=='s' and val: val=strings[int(val)]
            if val: cells.append({'cell':c.attrib['r'],'value':val})
    config={'sourceWorkbook':path.name,'sourceSheet':'MAIN','mainCategories':parents,'zodiacSigns':signs,'rules':{'money-magnet-main':{'collectionHandles':['money','pyrite'],'titleWords':['pyrite','money','dhan'],'sourceCell':'D2','fixedSelectionStatus':'pending merchant selection'},'kavach-main':{'titleWords':['kavach','kawach'],'sourceCell':'D9'}}}
    (ROOT/'src/data/main-categories.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    notes=[c for c in cells if re.match(r'^(D|U|V|W|X|Y|Z|AB|AD)\d+$',c['cell'])]
    report={'sourceWorkbook':path.name,'mainSequence':category_rows,'mainCategories':parents,'zodiacSigns':signs,'allPopulatedMainCells':cells,'extraNotes':notes,'policy':'External product URLs are reference notes only; no remote art or product memberships imported from URLs. Remedy labels are client navigation labels, not efficacy claims.','mappingManifest':'Existing explicit relationship manifests retained; MAIN changes presentation and rules only.','malaHierarchy':{'childrenSupplied':False,'missing':['Pearl Mala child relationship','Ruby Mala child relationship'],'note':'No Mala/Pearl/Ruby hierarchy or claimed 25-product list supplied in MAIN. Existing Mala direct route retained.'}}
    (ROOT/'reports/main-sheet-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('Generated eight main categories:', ', '.join(category_rows))
    print('Crystal children:',len(parents[5]['items']),'Remedy children:',len(parents[7]['items']),'populated MAIN cells:',len(cells))

if __name__=='__main__':
    generate(Path(sys.argv[1] if len(sys.argv)>1 else '/Users/apple/Downloads/New Website Product Catalog (1).xlsx'))
