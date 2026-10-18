import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\gurka\Downloads\haftalıkk.xlsx', read_only=True)
ws = wb.active
headers = None

flights_to_check = [
    'TK0391', 'TK0316', 'TK0299', 'TK0086', 'TK0069', 'TK1821', 
    'TK1722', 'TK0750', 'TK0034', 'TK2336', 'TK0032', 'TK0300', 
    'TK2503', 'TK2524', 'TK0717', 'TK0720', 'TK2555', 'TK2332', 
    'TK1980', 'TK0056', 'TK1022', 'TK2562', 'TK0202', 'TK0060', 
    'TK0018', 'TK2430'
]

results = []
for i, row in enumerate(ws.iter_rows(values_only=True)):
    if i == 0:
        headers = list(row)
        arr_idx = headers.index('Arr Flight')
        dep_idx = headers.index('Dep Flight')
        ac_idx = headers.index('A/C Type')
        sta_idx = headers.index('STA')
        std_idx = headers.index('STD')
        from_idx = headers.index('From Statition') if 'From Statition' in headers else headers.index('ArrCity')
        to_idx = headers.index('To Station') if 'To Station' in headers else headers.index('DepCity')
        id_indices = [idx for idx, h in enumerate(headers) if h == 'I/D']
    else:
        if len(row) <= max(arr_idx, dep_idx, ac_idx, sta_idx, std_idx, from_idx, to_idx, id_indices[-1]):
            continue
        arr = str(row[arr_idx] or '')
        dep = str(row[dep_idx] or '')
        for f in flights_to_check:
            if f == arr or f == dep:
                ac = str(row[ac_idx] or '')
                sta = str(row[sta_idx] or '')
                std = str(row[std_idx] or '')
                from_s = str(row[from_idx] or '')
                to_s = str(row[to_idx] or '')
                id_arr = str(row[id_indices[0]] or '')
                id_dep = str(row[id_indices[1]] or '') if len(id_indices) > 1 else ''
                results.append((arr, dep, ac, sta, std, from_s, to_s, id_arr, id_dep))
                break

print(f"Found {len(results)} matches:")
for r in results:
    arr, dep, ac, sta, std, from_s, to_s, id_arr, id_dep = r
    print(f"[{arr}/{dep}] A/C: {ac} | STA: {sta} -> STD: {std} | Route: {from_s} -> {to_s} | I/D: {id_arr}/{id_dep}")
